import { DATA_ATTR } from '../../components/constants/data-attributes';
import { IconArrowDiagonal, IconChevronRight, IconPage, IconPlus, IconTable } from '../../components/icons';
import { PopoverDesktop } from '../../components/utils/popover';
import { prefersReducedMotion } from '../../components/utils/reduced-motion';
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

/** A row of the picker. `kind: 'database'` draws the table glyph when it has no icon. */
type PickerPage = PageSearchResult & { kind?: 'database' };

/** The page to show, or null to drop it. A malformed path or status is ignored, not fatal. */
const toVisiblePage = (value: unknown): PickerPage | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const { pageId, access, title, icon, path, status, kind } = value as Record<string, unknown>;

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
    ...(kind === 'database' ? { kind } : {}),
  };
};

/** Rows shown before the "N more results" row. */
const COLLAPSED_ROWS = 6;

/** Only the active row is filled: the pointer moves it, so a hover fill would shade a second row. */
const ROW_FILL_CLASSES = 'mx-1 cursor-pointer rounded-(--blok-radius-inner,var(--blok-radius-control)) aria-selected:bg-item-focus-bg';
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
  /** Escape closed the picker. Runs after `onClose`. */
  onEscape?: () => void;
  /** Gets the active row's page title, or null when the active row is not a page. */
  onActiveTitle?: (title: string | null) => void;
  /** Gets the active row's element, or null when no row is active. */
  onActiveRow?: (row: HTMLElement | null) => void;
  /**
   * Runs between a pick and its `onPick`, with the list frozen. False drops the
   * pick; so does closing the picker before it settles.
   */
  beforePick?: (pageId: string, row: HTMLElement) => Promise<boolean>;
  /**
   * The popover's class and width, and `at`: its top-left corner, moving with `positionContext`.
   * With `flipBy` it opens above when it does not fit below, its bottom that far over the corner;
   * `margin` is its gap to the window's edges.
   */
  popover?: { class?: string; width?: string; at?: { position: DOMRect; positionContext: HTMLElement; flipBy?: number; margin?: number } };
  /** With `searchField`: a label over the pages, `idle` while nothing is typed and `query` after. */
  sections?: { idle: string; query: string };
  /** With `searchField`: false leaves the pages unhighlighted while nothing is typed, until a key or the pointer picks one. */
  highlightIdle?: boolean;
  /** True lists every page; otherwise the list folds after a few under a "N more results" row. */
  showAll?: boolean;
  /**
   * With `searchField`: a section after the pages while nothing is typed,
   * listing `children(null)` as a tree. A row's chevron shows and hides its
   * `children(pageId)`. ArrowRight and ArrowLeft do not, as in Notion
   * (notion-motion.md Round 64 §3). `open` and `close` name the chevron button.
   */
  tree?: { label: string; open: string; close: string; children: (pageId: string | null) => Promise<readonly unknown[]> };
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
  /** Set on page rows only. */
  title?: string;
  /** Set on tree rows that can open. */
  treePageId?: string;
}

/** Joins a tree row's key parts; a page id may hold any other character. */
const TREE_KEY_JOIN = '\u0000';

/** notion-motion.md Round 65 §3: a chevron turns over 0.2s ease-out. */
const CHEVRON_TURN = { duration: 200, easing: 'ease-out' } as const;

const CHEVRON_SVG = '[data-blok-testid="page-picker-tree-chevron"] svg';

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
  private onEscape: (() => void) | null = null;
  /** Set by an Escape seen on its way in; core's popover registry may close the picker before the field sees the key. */
  private escaping = false;
  private onActiveTitle: ((title: string | null) => void) | null = null;
  private onActiveRow: ((row: HTMLElement | null) => void) | null = null;
  private beforePick: ((pageId: string, row: HTMLElement) => Promise<boolean>) | null = null;
  /** True while `beforePick` is pending. */
  private holding = false;
  private listbox: HTMLElement | null = null;
  private content: HTMLElement | null = null;
  private onPick: ((pageId: string) => void) | null = null;
  private onChoose: ((pageId: string) => Promise<void>) | null = null;
  private newPage: PagePickerNewPage | null = null;
  /** Section headers show only in the inline menu, not under a search field. */
  private sectioned = false;
  private sections: PagePickerOptions['sections'] | null = null;
  private highlightIdle = true;
  private showAll = false;
  private results: PickerPage[] = [];
  private entries: Entry[] = [];
  private query = '';
  private loading = false;
  private answered = false;
  private expanded = false;
  private busyKey: string | null = null;
  private activeIndex = -1;
  private keyboardNavigated = false;
  private previousAttributes: Map<string, string | null> | null = null;
  private tree: PagePickerOptions['tree'] | null = null;
  /** Loaded children by parent page id, null for the top. Kept across queries. */
  private treeChildren = new Map<string | null, PickerPage[]>();
  private treeOpen = new Set<string>();
  /** One request per page at a time: a reopen waits for the first answer. */
  private treeLoading = new Set<string | null>();
  /** Bumped on close, so an answer for an earlier opening is dropped. */
  private treeGeneration = 0;
  /**
   * Chevrons turning, by page id: the angle they turn from and when they started.
   * Each render draws new rows, so the turn is replayed on the new glyph from where it is.
   */
  private treeTurns = new Map<string, { from: string; at: number }>();

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

  /** The open popover's root, or null when closed. */
  public getElement(): HTMLElement | null {
    return this.popover?.getElement() ?? null;
  }

  public open(_query: string, anchor: HTMLElement, onPick: (pageId: string) => void, options: PagePickerOptions = {}): void {
    this.close();
    this.anchor = anchor;
    if (options.searchField === undefined) {
      this.previousAttributes = new Map(COMBOBOX_ATTRIBUTES.map((name) => [name, anchor.getAttribute(name)] as const));
    }
    this.onPick = onPick;
    this.onClose = options.onClose ?? null;
    this.onEscape = options.onEscape ?? null;
    if (this.onEscape !== null) {
      // Window capture runs before the registry's document listener.
      window.addEventListener('keydown', this.noteEscape, true);
    }
    this.onActiveTitle = options.onActiveTitle ?? null;
    this.onActiveRow = options.onActiveRow ?? null;
    this.beforePick = options.beforePick ?? null;
    this.sectioned = options.searchField === undefined;
    this.sections = options.searchField === undefined ? null : options.sections ?? null;
    this.highlightIdle = options.highlightIdle ?? true;
    this.showAll = options.showAll ?? false;
    this.newPage = options.searchField === undefined ? options.newPage ?? null : null;
    this.tree = options.searchField === undefined ? null : options.tree ?? null;
    this.content = document.createElement('div');
    const look = options.popover;
    const params = {
      items: [{ type: PopoverItemType.Html as const, element: this.content }],
      trigger: anchor,
      listbox: true,
      // With a field, the content is the listbox, so the field stays outside it.
      listboxId: options.searchField === undefined ? this.listboxId : undefined,
      // Search results arrive after show() measures the empty menu.
      minWidth: '240px',
      flippable: false,
      messages: { actions: this.label, nothingFound: this.nothingFound },
      ...(look?.class !== undefined ? { class: look.class } : {}),
      ...(look?.width !== undefined ? { width: look.width } : {}),
    };

    this.popover = new PopoverDesktop(look?.at === undefined
      ? params
      : {
        ...params,
        cover: true,
        position: look.at.position,
        positionContext: look.at.positionContext,
        ...(look.at.flipBy !== undefined ? { coverFlipOffset: look.at.flipBy } : {}),
        ...(look.at.margin !== undefined ? { viewportMargin: look.at.margin } : {}),
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
    this.loadTree(null);
  }

  /** A search for `query` started: shows the loading state and names the query in the New page items. */
  public startSearch(query: string): void {
    if (this.content === null || this.holding) {
      return;
    }
    this.query = query;
    this.loading = true;
    this.render();
  }

  public setResults(results: readonly unknown[]): void {
    if (this.content === null || this.holding) {
      return;
    }

    this.results = results.map(toVisiblePage).filter((page): page is PickerPage => page !== null);
    this.loading = false;
    this.answered = true;
    this.expanded = false;
    this.activeIndex = this.highlightIdle || this.query !== '' ? 0 : -1;
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
    this.sections = null;
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

    if (this.holding) {
      event.preventDefault();

      return true;
    }

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
    const onEscape = this.escaping ? this.onEscape : null;

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
    this.onEscape = null;
    this.escaping = false;
    window.removeEventListener('keydown', this.noteEscape, true);
    this.onActiveTitle = null;
    this.onActiveRow = null;
    this.beforePick = null;
    this.holding = false;
    this.newPage = null;
    this.sections = null;
    this.highlightIdle = true;
    this.showAll = false;
    this.results = [];
    this.entries = [];
    this.query = '';
    this.loading = false;
    this.answered = false;
    this.expanded = false;
    this.busyKey = null;
    this.activeIndex = -1;
    this.keyboardNavigated = false;
    this.tree = null;
    this.treeChildren = new Map();
    this.treeOpen = new Set();
    this.treeLoading = new Set();
    this.treeGeneration++;
    this.treeTurns = new Map();
    document.removeEventListener('pointerdown', this.handleOutsidePointer, true);
    content?.replaceChildren();
    listbox?.removeAttribute('role');
    listbox?.removeAttribute('aria-busy');
    listbox?.removeAttribute('aria-label');
    listbox?.removeAttribute('id');
    search?.destroy();
    popover?.destroy();
    onClose?.();
    onEscape?.();
  }

  private readonly noteEscape = (event: KeyboardEvent): void => {
    const root = this.popover?.getElement();

    if (event.key === 'Escape' && !event.isComposing && root !== undefined && event.target instanceof Node && root.contains(event.target)) {
      this.escaping = true;
    }
  };

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

  private pick(pageId: string, row: HTMLElement): void {
    const onPick = this.onPick;
    const popover = this.popover;

    if (onPick === null) {
      return;
    }

    const finish = (): void => {
      // A pick is not a close: onClose stays silent.
      this.onClose = null;
      this.close();
      onPick(pageId);
    };

    if (this.beforePick === null) {
      finish();

      return;
    }

    const release = (go: boolean): void => {
      // Closed or reopened meanwhile: the pick is gone with that opening.
      if (this.popover !== popover) {
        return;
      }
      this.holding = false;
      if (go) {
        finish();
      }
    };

    this.holding = true;
    this.beforePick(pageId, row).then(release, () => release(false));
  }

  private activate(index: number): void {
    const entry = this.entries[index];

    if (entry === undefined || this.busyKey !== null || this.holding) {
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

    const visible = this.expanded || this.showAll ? this.results : this.results.slice(0, COLLAPSED_ROWS);
    const hidden = this.results.length - visible.length;
    const rows: HTMLElement[] = [];
    const entries: Entry[] = [];
    const add = (entry: Entry): void => {
      entry.element.setAttribute('id', `${this.listboxId}-option-${entries.length}`);
      entries.push(entry);
      rows.push(entry.element);
    };

    if (this.sectioned && (visible.length > 0 || this.loading)) {
      rows.push(this.buildHeader('link', this.t('toolNames.pageLink')));
    }
    if (this.sections !== null && this.sections !== undefined && (visible.length > 0 || this.loading)) {
      rows.push(this.buildHeader('link', this.query === '' ? this.sections.idle : this.sections.query));
    }
    visible.forEach((result) => {
      const element = this.buildPageOption(result);

      add({
        key: `page:${result.pageId}`,
        element,
        run: () => this.onChoose !== null ? this.onChoose(result.pageId) : this.pick(result.pageId, element),
        title: result.title || this.fallback,
      });
    });
    if (hidden > 0) {
      add({ key: 'more', element: this.buildMoreOption(hidden), run: () => this.expand() });
    }
    if (this.loading && this.results.length === 0) {
      rows.push(skeletonRow(), skeletonRow());
    }
    this.appendTree(rows, add);
    if (this.newPage !== null) {
      this.appendNewPageSection(this.newPage, rows, add);
    }

    const focused = document.activeElement;
    const focusedChevron = focused instanceof HTMLElement && focused.matches('[data-blok-testid="page-picker-tree-chevron"]')
      ? this.entries.find((entry) => entry.element.contains(focused))?.key
      : undefined;

    this.entries = entries;
    this.activeIndex = entries.length === 0 ? -1 : Math.min(Math.max(this.activeIndex, this.highlightIdle || this.query !== '' ? 0 : -1), entries.length - 1);
    content.replaceChildren(...rows);
    if (focusedChevron !== undefined) {
      this.chevronOf(focusedChevron)?.focus({ preventScroll: true });
    }
    this.replayTurns();
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

  private appendTree(rows: HTMLElement[], add: (entry: Entry) => void): void {
    const top = this.treeChildren.get(null) ?? [];

    if (this.tree === null || this.tree === undefined || this.query !== '' || top.length === 0) {
      return;
    }
    rows.push(this.buildHeader('workspace', this.tree.label));
    const walk = (pages: PickerPage[], trail: string[]): void => pages.forEach((page) => {
      // A host loop would otherwise open forever.
      if (trail.includes(page.pageId)) {
        return;
      }
      const opens = page.kind !== 'database';
      const open = opens && this.treeOpen.has(page.pageId);

      const key = ['tree', ...trail, page.pageId].join(TREE_KEY_JOIN);
      const element = this.buildTreeOption(page, trail.length, opens ? open : null, key);

      add({
        key,
        element,
        run: () => this.onChoose !== null ? this.onChoose(page.pageId) : this.pick(page.pageId, element),
        title: page.title || this.fallback,
        ...(opens ? { treePageId: page.pageId } : {}),
      });
      if (open) {
        walk(this.treeChildren.get(page.pageId) ?? [], [...trail, page.pageId]);
      }
    });

    walk(top, []);
  }

  /** Asks for a page's children once; the answer shows only if the picker and the row are still open. */
  private loadTree(pageId: string | null): void {
    const tree = this.tree;

    if (tree === null || tree === undefined || this.treeChildren.has(pageId) || this.treeLoading.has(pageId)) {
      return;
    }
    const generation = this.treeGeneration;
    const settle = (pages: PickerPage[] | null): void => {
      if (generation !== this.treeGeneration) {
        return;
      }
      this.treeLoading.delete(pageId);
      // A failed load shows nothing and is asked again on the next open.
      if (pages !== null) {
        this.treeChildren.set(pageId, pages);
      }
      if (pages !== null && (pageId === null || this.treeOpen.has(pageId))) {
        this.renderKeepingActive();
      }
    };

    this.treeLoading.add(pageId);
    Promise.resolve()
      .then(() => tree.children(pageId))
      .then((pages) => settle(pages.map(toVisiblePage).filter((page): page is PickerPage => page !== null)), () => settle(null));
  }

  private toggleTree(pageId: string): void {
    const glyph = this.entries.find((entry) => entry.treePageId === pageId)?.element.querySelector(CHEVRON_SVG);

    this.treeTurns.set(pageId, { from: glyph === null || glyph === undefined ? 'none' : getComputedStyle(glyph).rotate, at: performance.now() });
    const active = this.entries[this.activeIndex];
    const row = this.entries.find((entry) => entry.treePageId === pageId && active?.key.startsWith(`${entry.key}${TREE_KEY_JOIN}`));

    if (this.treeOpen.delete(pageId)) {
      // The highlight on a row that goes away moves to the row that closed.
      this.renderKeepingActive(row?.key);

      return;
    }
    this.treeOpen.add(pageId);
    this.loadTree(pageId);
    this.renderKeepingActive();
  }

  /** Renders, keeping the highlight on the same row (or on `key`) while rows above it come and go. */
  private renderKeepingActive(key = this.entries[this.activeIndex]?.key): void {
    this.render();
    const at = key === undefined ? -1 : this.entries.findIndex((entry) => entry.key === key);

    if (at !== -1 && at !== this.activeIndex) {
      this.activeIndex = at;
      this.syncSelection(false);
    }
  }

  private expand(): void {
    this.expanded = true;
    this.render();
  }

  private buildHeader(name: 'link' | 'new' | 'workspace', text: string): HTMLElement {
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
    this.listenToPointer(option);

    return { option, body };
  }

  private buildPageOption(result: PickerPage): HTMLElement {
    const { option, body } = this.buildRow('page-picker-option', pageIconNode(result.icon, result.kind === 'database' ? IconTable : IconPage));
    const line = document.createElement('div');
    const title = document.createElement('span');

    line.className = 'flex items-center gap-1.5 min-w-0 leading-5';
    line.setAttribute('data-blok-page-picker-line', '');
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

  /** `open` is null for a row that cannot open: it gets no chevron. Tree rows show no path. */
  private buildTreeOption(page: PickerPage, depth: number, open: boolean | null, key: string): HTMLElement {
    const option = this.buildPageOption({ ...page, path: undefined });
    const labels = this.tree;

    option.setAttribute('data-blok-page-picker-tree-row', '');
    option.setAttribute('data-blok-page-picker-depth', String(depth));
    option.style.setProperty('--blok-page-picker-depth', String(depth));
    if (open === null || labels === null || labels === undefined) {
      return option;
    }
    const chevron = document.createElement('button');
    const glyph = document.createElement('template');

    option.setAttribute('data-blok-page-picker-expanded', String(open));
    // A trusted constant from the icon module, not user input.
    glyph.innerHTML = IconChevronRight.trim();
    chevron.type = 'button';
    // Out of the Tab order: Tab in the search field closes the picker.
    chevron.tabIndex = -1;
    chevron.setAttribute('aria-label', open ? labels.close : labels.open);
    chevron.setAttribute('aria-expanded', String(open));
    chevron.setAttribute(DATA_ATTR.testid, 'page-picker-tree-chevron');
    chevron.append(glyph.content);
    chevron.addEventListener('click', (event) => {
      // The row's own click picks the page.
      event.stopPropagation();
      this.toggleTree(page.pageId);
      // notion-motion.md Round 65 §3: focus goes to the chevron. The row is drawn anew, so focus its new chevron.
      this.chevronOf(key)?.focus({ preventScroll: true });
    });
    // notion-motion.md Round 67 §4 and Round 68 §5: Tab moves to the next row, Shift+Tab to the chevron's own row; the picker stays open.
    // Tab on the last row goes to Notion's workspace footer, which Blok does not have, so it falls through.
    chevron.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      const index = this.entries.findIndex((entry) => entry.key === key);
      const next = index === -1 ? undefined : this.entries[event.shiftKey ? index : index + 1]?.element;

      if (next === undefined) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      next.tabIndex = -1;
      next.focus({ preventScroll: true });
    });
    option.prepend(chevron);

    return option;
  }

  private chevronOf(key: string): HTMLElement | null {
    return this.entries.find((entry) => entry.key === key)?.element.querySelector<HTMLElement>('[data-blok-testid="page-picker-tree-chevron"]') ?? null;
  }

  /** Plays each turning chevron's turn on its new glyph, from where it has got to. */
  private replayTurns(): void {
    const now = performance.now();
    const moves = !prefersReducedMotion();

    this.treeTurns.forEach((turn, pageId) => {
      const elapsed = now - turn.at;

      if (!moves || elapsed >= CHEVRON_TURN.duration) {
        this.treeTurns.delete(pageId);

        return;
      }
      this.entries.filter((entry) => entry.treePageId === pageId).forEach(({ element }) => {
        const glyph = element.querySelector(CHEVRON_SVG);

        if (glyph === null || typeof glyph.animate !== 'function') {
          return;
        }
        const animation = glyph.animate([{ rotate: turn.from }, { rotate: getComputedStyle(glyph).rotate }], CHEVRON_TURN);

        animation.currentTime = elapsed;
      });
    });
  }

  private buildMoreOption(count: number): HTMLElement {
    const option = document.createElement('div');

    option.setAttribute('role', 'option');
    option.setAttribute(DATA_ATTR.testid, 'page-picker-more');
    option.className = `${ROW_FILL_CLASSES} block px-2 py-1.5 text-sm leading-5 text-text-secondary`;
    option.textContent = this.t('tools.page.moreResults', { count });
    this.listenToPointer(option);

    return option;
  }

  /**
   * Pointer motion makes the row active, as in the "/" menu. pointermove, not
   * mouseover: a menu opening under a resting pointer gets a synthesized
   * mouseover, which would steal the first row from the keyboard.
   */
  private listenToPointer(option: HTMLElement): void {
    const index = (): number => this.entries.findIndex((entry) => entry.element === option);

    option.addEventListener('pointerdown', (event) => event.preventDefault());
    option.addEventListener('click', () => this.activate(index()));
    option.addEventListener('pointermove', () => {
      const at = index();

      if (at === -1 || this.holding || (at === this.activeIndex && !this.keyboardNavigated)) {
        return;
      }
      this.activeIndex = at;
      this.keyboardNavigated = false;
      // The row is under the pointer, so it is in view; scrolling would move it away.
      this.syncSelection(false);
    });
  }

  /** `label` holds QUERY_MARK where the query goes; the query is drawn bold, as text. */
  private buildActionOption(testid: string, icon: string, label: string): HTMLElement {
    const glyph = document.createElement('template');

    // A trusted constant from the icon module, not user input.
    glyph.innerHTML = icon;

    const { option, body } = this.buildRow(testid, glyph.content);
    const line = document.createElement('span');

    line.className = 'truncate leading-5';
    line.setAttribute('data-blok-page-picker-line', '');
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

  private syncSelection(scroll = true): void {
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
    const activeEntry = this.entries[this.activeIndex];
    const active = activeEntry?.element;

    this.onActiveTitle?.(activeEntry?.title ?? null);
    this.onActiveRow?.(active ?? null);
    if (active === undefined) {
      this.combobox?.removeAttribute('aria-activedescendant');
    } else {
      this.combobox?.setAttribute('aria-activedescendant', active.id);
      if (scroll) {
        active.scrollIntoView?.({ block: 'nearest' });
      }
    }
  }
}
