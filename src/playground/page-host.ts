import type { I18n, OutputBlockData } from '../../types';
import type { PageInfo } from '../../types/tools/page';
import { IconEmojiSmile } from '../components/icons';
import { EmojiPicker } from '../tools/callout/emoji-picker';

/**
 * The playground's own "host app" for page blocks. Blok only links to pages;
 * this file keeps them: a registry in localStorage, routes, the page header,
 * and the transition between pages.
 */

export interface PageRecord {
  title: string;
  /** An emoji. */
  icon?: string;
  /** null = the root playground document. */
  parentId: string | null;
  blocks: OutputBlockData[];
  /** Its block was removed from the parent: the page is in Trash. */
  trashed?: true;
  /** Restored from Trash; the parent still needs its block back. */
  restorePending?: true;
}

export type PageMap = Record<string, PageRecord>;

export const PAGES_STORAGE_KEY = 'blok-playground-pages';

/** The root playground document's name, in breadcrumbs and page paths. */
const ROOT_LABEL = 'Playground';

/** Pages deleted for good. Without it a deleted seed page returns on reload. */
const PURGED_STORAGE_KEY = 'blok-playground-pages-purged';

const ROUTE = /^\/editor\/page\/([^/]+)\/?$/;

/** The page id in an `/editor/page/<id>` path, or null for the root document. */
export const pageIdFromPath = (pathname: string): string | null => {
  const match = ROUTE.exec(pathname);

  if (match === null) {
    return null;
  }

  // Runs at playground boot: a throw on a bad escape would blank the page.
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
};

/** Keeps the query: `?collab=` and `?name=` are read again on every editor rebuild. */
export const pagePath = (pageId: string | null, search: string): string =>
  pageId === null ? `/editor${search}` : `/editor/page/${encodeURIComponent(pageId)}${search}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readStored = (): PageMap => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PAGES_STORAGE_KEY) ?? '{}');

    return isRecord(parsed) ? (parsed as PageMap) : {};
  } catch {
    return {};
  }
};

const readPurged = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PURGED_STORAGE_KEY) ?? '[]');

    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

export class PageRegistry {
  private pages: PageMap;

  constructor(private readonly seed: PageMap) {
    // Stored edits win, but a page added to the seed later still shows up.
    const purged = readPurged();

    this.pages = Object.fromEntries(
      Object.entries({ ...structuredClone(seed), ...readStored() }).filter(([id]) => !purged.includes(id))
    );
  }

  public get(pageId: string): PageRecord | undefined {
    return Object.hasOwn(this.pages, pageId) ? this.pages[pageId] : undefined;
  }

  public has(pageId: string): boolean {
    return this.get(pageId) !== undefined;
  }

  /** What the page block's `resolve` gets. */
  public info(pageId: string): PageInfo | null {
    const page = this.get(pageId);

    if (page === undefined) {
      return null;
    }

    const above = this.trail(pageId).slice(0, -1).map((entry) => (entry.title.trim() === '' ? 'Untitled' : entry.title));

    return {
      title: page.title,
      ...(page.icon !== undefined && { icon: { type: 'emoji' as const, value: page.icon } }),
      path: [ROOT_LABEL, ...above],
    };
  }

  public create(pageId: string, parentId: string | null): void {
    if (this.has(pageId)) {
      return;
    }
    this.pages[pageId] = { title: '', parentId, blocks: [] };
    this.persist();
  }

  public setTitle(pageId: string, title: string): void {
    this.edit(pageId, (page) => ({ ...page, title }));
  }

  public setIcon(pageId: string, icon: string | undefined): void {
    this.edit(pageId, ({ icon: _old, ...page }) => (icon === undefined ? page : { ...page, icon }));
  }

  public setBlocks(pageId: string, blocks: OutputBlockData[]): void {
    this.edit(pageId, (page) => ({ ...page, blocks }));
  }

  /** Pages from the top down to `pageId`, for breadcrumbs. The root document is not in it. */
  public trail(pageId: string): Array<PageRecord & { id: string }> {
    const climb = (id: string | null, below: Array<PageRecord & { id: string }>): Array<PageRecord & { id: string }> => {
      const page = id === null ? undefined : this.get(id);

      // A parent cycle stops at the first page seen twice.
      if (id === null || page === undefined || below.some((entry) => entry.id === id)) {
        return below;
      }

      return climb(page.parentId, [{ ...page, id }, ...below]);
    };

    return climb(pageId, []);
  }

  public trash(pageId: string): void {
    if (this.get(pageId)?.trashed === true) {
      return;
    }
    this.edit(pageId, (page) => ({ ...page, trashed: true }));
  }

  public untrash(pageId: string): void {
    if (this.get(pageId)?.trashed !== true) {
      return;
    }
    this.edit(pageId, ({ trashed: _old, ...page }) => page);
  }

  /** The trashed page that puts `pageId` in Trash: itself or an ancestor. */
  public trashedIn(pageId: string): (PageRecord & { id: string }) | null {
    return this.trail(pageId).find((page) => page.trashed === true) ?? null;
  }

  public restore(pageId: string): void {
    this.edit(pageId, ({ trashed: _old, ...page }) => ({ ...page, restorePending: true }));
  }

  /** Restored pages whose block `parentId` still has to put back. */
  public pendingRestores(parentId: string | null): string[] {
    return Object.keys(this.pages).filter((id) => this.pages[id].restorePending === true && this.pages[id].parentId === parentId);
  }

  public restored(pageId: string): void {
    this.edit(pageId, ({ restorePending: _old, ...page }) => page);
  }

  /** Deletes the page and its sub-pages for good. Returns its parent, the page to show next. */
  public purge(pageId: string): string | null {
    const parentId = this.get(pageId)?.parentId ?? null;
    const doomed = new Set([pageId]);

    // Sub-pages first point at the page, then at each other: grow until stable.
    const collect = (): void => {
      const before = doomed.size;

      Object.entries(this.pages)
        .filter(([, page]) => page.parentId !== null && doomed.has(page.parentId))
        .forEach(([id]) => doomed.add(id));
      if (doomed.size > before) {
        collect();
      }
    };

    collect();
    this.pages = Object.fromEntries(Object.entries(this.pages).filter(([id]) => !doomed.has(id)));
    this.persist();
    try {
      localStorage.setItem(PURGED_STORAGE_KEY, JSON.stringify([...new Set([...readPurged(), ...doomed])]));
    } catch {
      // Blocked storage: the page is gone for this tab only.
    }

    return parentId;
  }

  public reset(): void {
    try {
      localStorage.removeItem(PAGES_STORAGE_KEY);
      localStorage.removeItem(PURGED_STORAGE_KEY);
    } catch {
      // Storage blocked: the in-memory reset below still applies.
    }
    this.pages = structuredClone(this.seed);
  }

  private edit(pageId: string, change: (page: PageRecord) => PageRecord): void {
    const page = this.get(pageId);

    if (page === undefined) {
      return;
    }
    this.pages[pageId] = change(page);
    this.persist();
  }

  private persist(): void {
    try {
      localStorage.setItem(PAGES_STORAGE_KEY, JSON.stringify(this.pages));
    } catch {
      // Quota or blocked storage: the page still works for this tab.
    }
  }
}

/* ----------------------------------------------------------------- trash */

const pointedPages = (blocks: OutputBlockData[]): string[] =>
  blocks.flatMap((block) => (block.type === 'page' && typeof block.data?.pageId === 'string' ? [block.data.pageId] : []));

/**
 * Notion's Trash, derived from page blocks: a page whose block this editor saw
 * and then lost is trashed; a page whose block is there is not. A block missing
 * from the start trashes nothing: a collaborative document renders late, and
 * the root document forgets its pages on reload.
 */
export class PointerWatch {
  private readonly seen = new Set<string>();

  constructor(private readonly pages: PageRegistry) {}

  public observe(blocks: OutputBlockData[]): void {
    const present = new Set(pointedPages(blocks));

    this.seen.forEach((id) => {
      if (!present.has(id)) {
        this.seen.delete(id);
        this.pages.trash(id);
      }
    });
    present.forEach((id) => {
      this.seen.add(id);
      this.pages.untrash(id);
    });
  }
}

export const hasPointer = (blocks: OutputBlockData[], pageId: string): boolean => pointedPages(blocks).includes(pageId);

/** A page block for `pageId`, to put back into its parent on restore. */
export const pointerBlock = (pageId: string, pages: PageRegistry): OutputBlockData => {
  const page = pages.get(pageId);

  return {
    id: `page-${pageId}-${Date.now().toString(36)}`,
    type: 'page',
    data: {
      pageId,
      cache: {
        title: page?.title ?? '',
        ...(page?.icon !== undefined && { icon: { type: 'emoji', value: page.icon } }),
      },
    },
  };
};

/* ---------------------------------------------------------------- header */

export interface PageHeaderOptions {
  pageId: string | null;
  pages: PageRegistry;
  search: string;
  readOnly: boolean;
  /** Plain click on a breadcrumb. */
  navigate(pageId: string | null): void;
  /** Enter in the title. */
  focusEditor(): void;
  /** The current editor's i18n and locale, for the emoji picker's strings. */
  i18n(): { i18n: I18n; locale: string };
  /** Title or icon changed. */
  changed(): void;
  /** "Restore page" on the Trash banner, for the trashed page. */
  restore(pageId: string): void;
  /** "Permanently delete" on the Trash banner, for the trashed page. */
  purge(pageId: string): void;
}

export const PAGE_TITLE_SELECTOR = '#pg-page-title';

/** The page block's title for `pageId`, as the parent page renders it. */
export const pageLinkSelector = (pageId: string): string => {
  const path = CSS.escape(`/editor/page/${encodeURIComponent(pageId)}`);

  return [`[href="${path}"]`, `[href^="${path}?"]`]
    .map((link) => `[data-blok-testid="page-link"]${link} [data-blok-testid="page-title"]`)
    .join(', ');
};


/**
 * Blok's radius roles are declared only on [data-blok-interface] elements, so
 * each rounded header control carries the attribute itself. Never the whole
 * header: the editor's preflight would then restyle the title h1.
 */
const takeRadiusRoles = (el: HTMLElement): void => el.setAttribute('data-blok-interface', 'page-header');

const isPlainClick = (event: MouseEvent): boolean =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

const crumb = (label: string, icon: string | undefined, href: string | null): HTMLElement => {
  const el = document.createElement(href === null ? 'span' : 'a');

  el.className = 'pg-crumb';
  takeRadiusRoles(el);
  if (href === null) {
    el.setAttribute('aria-current', 'page');
  } else {
    el.setAttribute('href', href);
  }
  if (icon !== undefined) {
    const glyph = document.createElement('span');

    glyph.className = 'pg-crumb-icon';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = icon;
    el.append(glyph);
  }

  const text = document.createElement('span');

  text.className = 'pg-crumb-text';
  text.textContent = label;
  el.append(text);

  return el;
};

/** Draws the header of the page being shown. Empty and hidden on the root document. */
export const renderPageHeader = (host: HTMLElement, options: PageHeaderOptions): void => {
  const { pageId, pages, search } = options;
  const page = pageId === null ? undefined : pages.get(pageId);

  closeIconPicker();

  if (pageId === null || page === undefined) {
    host.toggleAttribute('hidden', true);
    host.replaceChildren();

    return;
  }

  host.toggleAttribute('hidden', false);

  const nav = document.createElement('nav');
  const list = document.createElement('ol');

  nav.className = 'pg-crumbs';
  nav.setAttribute('aria-label', 'Breadcrumb');

  const trail = pages.trail(pageId);
  const items: Array<{ id: string | null; el: HTMLElement }> = [
    { id: null, el: crumb(ROOT_LABEL, undefined, pagePath(null, search)) },
    ...trail.map((entry) => ({
      id: entry.id,
      el: crumb(entry.title.trim() === '' ? 'Untitled' : entry.title, entry.icon, entry.id === pageId ? null : pagePath(entry.id, search)),
    })),
  ];

  items.forEach(({ id, el }, index) => {
    const li = document.createElement('li');

    if (index > 0) {
      const sep = document.createElement('span');

      sep.className = 'pg-crumb-sep';
      sep.setAttribute('aria-hidden', 'true');
      sep.textContent = '/';
      li.append(sep);
    }
    if (el instanceof HTMLAnchorElement) {
      el.addEventListener('click', (event) => {
        if (!isPlainClick(event)) {
          return;
        }
        event.preventDefault();
        options.navigate(id);
      });
    }
    li.append(el);
    list.append(li);
  });
  nav.append(list);

  const current = items[items.length - 1].el;
  const currentText = current.querySelector('.pg-crumb-text');

  const iconRow = document.createElement('div');

  iconRow.className = 'pg-page-icon-row';

  const iconButton = document.createElement('button');

  iconButton.type = 'button';
  takeRadiusRoles(iconButton);
  iconButton.disabled = options.readOnly;

  const drawIcon = (): void => {
    const icon = pages.get(pageId)?.icon;

    iconButton.className = icon === undefined ? 'pg-page-add-icon' : 'pg-page-icon';
    iconButton.setAttribute('aria-label', icon === undefined ? 'Add icon' : 'Change icon');
    if (icon === undefined) {
      // A trusted constant from the icon module, not user input.
      iconButton.innerHTML = `${IconEmojiSmile}<span>Add icon</span>`;
    } else {
      iconButton.textContent = icon;
    }
    iconRow.classList.toggle('has-icon', icon !== undefined);

    const crumbIcon = current.querySelector('.pg-crumb-icon');

    if (icon === undefined) {
      crumbIcon?.remove();
    } else if (crumbIcon === null) {
      current.prepend(Object.assign(document.createElement('span'), { className: 'pg-crumb-icon', textContent: icon }));
    } else {
      crumbIcon.textContent = icon;
    }
  };

  const setIcon = (icon: string | undefined): void => {
    pages.setIcon(pageId, icon);
    drawIcon();
    options.changed();
  };

  iconButton.addEventListener('click', () => {
    const { i18n, locale } = options.i18n();

    openIconPicker(iconButton, i18n, locale, (native) => setIcon(native), () => setIcon(undefined));
  });
  drawIcon();
  iconRow.append(iconButton);

  const title = document.createElement('h1');

  title.id = PAGE_TITLE_SELECTOR.slice(1);
  title.className = 'pg-page-title';
  title.textContent = page.title;
  title.setAttribute('data-placeholder', 'Untitled');
  title.setAttribute('role', 'textbox');
  title.setAttribute('aria-label', 'Page title');
  title.spellcheck = false;
  title.contentEditable = options.readOnly ? 'false' : 'true';

  title.addEventListener('input', () => {
    const text = (title.textContent ?? '').replace(/\n/g, ' ');

    // A stray <br> left by the browser would hide the placeholder.
    if (text === '') {
      title.replaceChildren();
    }
    pages.setTitle(pageId, text);
    if (currentText !== null) {
      currentText.textContent = text.trim() === '' ? 'Untitled' : text;
    }
    options.changed();
  });
  title.addEventListener('paste', (event) => {
    event.preventDefault();

    const range = window.getSelection()?.getRangeAt(0);
    const text = document.createTextNode((event.clipboardData?.getData('text/plain') ?? '').replace(/\s*\n\s*/g, ' '));

    if (range === undefined || !title.contains(range.commonAncestorContainer)) {
      return;
    }
    range.deleteContents();
    range.insertNode(text);
    range.setStartAfter(text);
    range.collapse(true);
    title.normalize();
    title.dispatchEvent(new Event('input'));
  });
  title.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) {
      return;
    }
    event.preventDefault();
    options.focusEditor();
  });

  const trashed = pages.trashedIn(pageId);

  host.replaceChildren(...(trashed === null ? [] : [trashBanner(trashed, pageId, options)]), nav, iconRow, title);
};

const trashBanner = (trashed: PageRecord & { id: string }, pageId: string, options: PageHeaderOptions): HTMLElement => {
  const banner = document.createElement('div');
  const text = document.createElement('p');
  const name = trashed.title.trim() === '' ? 'Untitled' : trashed.title;

  banner.className = 'pg-trash-banner';
  takeRadiusRoles(banner);
  banner.setAttribute('role', 'status');
  text.textContent = trashed.id === pageId
    ? 'This page is in Trash.'
    : `This page is in Trash with “${name}”.`;
  banner.append(text);

  const actions: Array<[string, () => void]> = [
    ['Restore page', () => options.restore(trashed.id)],
    ['Permanently delete', () => options.purge(trashed.id)],
  ];

  if (!options.readOnly) {
    actions.forEach(([label, run]) => {
      const button = document.createElement('button');

      button.type = 'button';
      button.className = 'pg-trash-action';
      button.textContent = label;
      button.addEventListener('click', run);
      banner.append(button);
    });
  }

  return banner;
};

/* ----------------------------------------------------------- icon picker */

const pickerSlot: { current: { instance: EmojiPicker; i18n: I18n; locale: string } | null } = { current: null };

const openIconPicker = (
  anchor: HTMLElement,
  i18n: I18n,
  locale: string,
  onSelect: (native: string) => void,
  onRemove: () => void
): void => {
  // Each editor has its own i18n; a picker built for a destroyed one is dropped.
  if (pickerSlot.current === null || pickerSlot.current.i18n !== i18n || pickerSlot.current.locale !== locale) {
    disposeIconPicker();
    pickerSlot.current = { instance: new EmojiPicker({ onSelect, onRemove, i18n, locale }), i18n, locale };
  }

  const element = pickerSlot.current.instance.getElement();

  if (!element.isConnected) {
    document.body.append(element);
  }
  void pickerSlot.current.instance.open(anchor, undefined, { onSelect, onRemove });
};

const closeIconPicker = (): void => {
  if (pickerSlot.current?.instance.isOpen() === true) {
    pickerSlot.current.instance.close();
  }
};

const disposeIconPicker = (): void => {
  closeIconPicker();
  pickerSlot.current?.instance.getElement().remove();
  pickerSlot.current = null;
};

/* ------------------------------------------------------------ transition */

export interface PageTransitionOptions {
  direction: 'forward' | 'back';
  /** The element in the page being left that morphs into `to`. */
  from: string | null;
  to: string | null;
}

/**
 * Runs `update` inside a view transition: the body slides, and `from` morphs
 * into `to` (a page row's title into the big title, or back). Instant when the
 * API is missing or the user asked for reduced motion.
 */
export const runPageTransition = async (update: () => Promise<void>, options: PageTransitionOptions): Promise<void> => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (typeof document.startViewTransition !== 'function' || reduced) {
    await update();

    return;
  }

  const root = document.documentElement;
  // A name set on Blok's DOM through a sheet, not inline: the old editor is
  // still live when the old snapshot is taken.
  const morph = document.createElement('style');
  const name = (selector: string | null): string =>
    selector === null ? '' : `${selector} { view-transition-name: pg-page-title; }`;

  morph.textContent = name(options.from);
  document.head.append(morph);
  root.classList.add('pg-page-nav');
  root.setAttribute('data-pg-page-dir', options.direction);

  const transition = document.startViewTransition(async () => {
    await update();
    morph.textContent = name(options.to);
  });

  try {
    await transition.updateCallbackDone;
    await transition.finished;
  } catch {
    // A skipped transition (two elements with one name, a hidden tab) still ran update.
  } finally {
    morph.remove();
    root.classList.remove('pg-page-nav');
    root.removeAttribute('data-pg-page-dir');
  }
};

/* ------------------------------------------------------------------ seed */

const paragraph = (id: string, text: string): OutputBlockData => ({ id, type: 'paragraph', data: { text } });

const pageLink = (id: string, pageId: string, title: string, icon: string): OutputBlockData => ({
  id,
  type: 'page',
  data: { pageId, cache: { title, icon: { type: 'emoji', value: icon } } },
});

/** Pages the root playground document links to (`playground-document.json` uses these ids). */
export const SEED_PAGES: PageMap = {
  'getting-started': {
    title: 'Getting started',
    icon: '🚀',
    parentId: null,
    blocks: [
      paragraph('gs-intro', 'This is a page inside the playground. It is its own document: edits here are saved to this page, not to the one you came from.'),
      { id: 'gs-h-try', type: 'header', data: { text: 'Things to try', level: 2 } },
      { id: 'gs-try-1', type: 'list', data: { style: 'checklist', text: 'Rename this page in the big title above', checked: false } },
      { id: 'gs-try-2', type: 'list', data: { style: 'checklist', text: 'Pick an icon, then go back: the link shows it', checked: false } },
      { id: 'gs-try-3', type: 'list', data: { style: 'checklist', text: 'Type <code>/page</code> to make a sub-page', checked: false } },
      { id: 'gs-h-sub', type: 'header', data: { text: 'Sub-pages', level: 2 } },
      paragraph('gs-sub-intro', 'Pages nest as deep as you like. The breadcrumbs at the top always lead back.'),
      pageLink('gs-link-shortcuts', 'keyboard-shortcuts', 'Keyboard shortcuts', '⌨️'),
    ],
  },
  'keyboard-shortcuts': {
    title: 'Keyboard shortcuts',
    icon: '⌨️',
    parentId: 'getting-started',
    blocks: [
      paragraph('ks-intro', 'A few keys worth knowing.'),
      { id: 'ks-1', type: 'list', data: { style: 'unordered', text: '<b>/</b> opens the block menu' } },
      { id: 'ks-2', type: 'list', data: { style: 'unordered', text: '<b>Tab</b> and <b>Shift+Tab</b> nest and un-nest list items' } },
      { id: 'ks-3', type: 'list', data: { style: 'unordered', text: '<b>Cmd/Ctrl+F</b> finds text on the page' } },
      { id: 'ks-4', type: 'list', data: { style: 'unordered', text: '<b>Escape</b> selects the current block' } },
    ],
  },
  'design-notes': {
    title: 'Design notes',
    icon: '🎨',
    parentId: null,
    blocks: [
      paragraph('dn-intro', 'Calm, neutral, and quiet until you need it.'),
      { id: 'dn-1', type: 'list', data: { style: 'ordered', text: 'Content first, chrome second' } },
      { id: 'dn-2', type: 'list', data: { style: 'ordered', text: 'Selected states are gray, never blue' } },
      { id: 'dn-3', type: 'list', data: { style: 'ordered', text: 'Motion explains where you went' } },
    ],
  },
};

/**
 * Puts the header over the editor's text column. The column's offset comes
 * from the editor's own gutter (block controls), which depends on toolbar
 * side, direction and width, so it is measured, not copied into CSS.
 */
export const alignPageHeader = (header: HTMLElement, holder: HTMLElement): void => {
  const content = holder.querySelector('[data-blok-element-content]');
  const column = header.parentElement;

  if (header.hidden || content === null || column === null) {
    return;
  }

  const box = content.getBoundingClientRect();

  header.style.setProperty('margin-left', `${Math.round(box.left - column.getBoundingClientRect().left)}px`);
  header.style.setProperty('max-width', `${Math.round(box.width)}px`);
};

/**
 * Re-aligns whenever the editor box changes size. A collaborative document
 * renders after `isReady`, so a one-off measurement finds no blocks yet.
 */
export const keepPageHeaderAligned = (header: HTMLElement, holder: HTMLElement): void => {
  new ResizeObserver(() => alignPageHeader(header, holder)).observe(holder);
};
