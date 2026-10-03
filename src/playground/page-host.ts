import type { I18n, OutputBlockData } from '../../types';
import type { PageInfo } from '../../types/tools/page';
import { IconEmojiSmile } from '../components/icons';
import { EmojiPicker } from '../tools/callout/emoji-picker';
import { DATA_ATTR } from '../components/constants/data-attributes';
import { findOwn } from '../components/utils/own-element';
import { getCaretXPosition, isCaretAtFirstLine, isCaretAtLastLine, setCaretAtXPosition } from '../components/utils/caret';
import { loadEmojiGrid } from '../components/utils/emoji/emoji-data';
import seedPages from '../../playground-pages.json';

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
const ROOT_LABEL = 'Blok';
const LEGACY_ROOT_LABEL = 'Playground';

/** The root document's title and icon. Apart from the page map, so no page loop meets it. */
export const ROOT_STORAGE_KEY = 'blok-playground-root';

export type RootRecord = Pick<PageRecord, 'title' | 'icon'>;

const untitled = (title: string): string => (title.trim() === '' ? 'New page' : title);

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

const readRoot = (): RootRecord => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ROOT_STORAGE_KEY) ?? '{}');

    if (isRecord(parsed)) {
      // A missing title is the default. 'Playground' was the old default, saved
      // whenever an icon was picked, so it reads as the default too.
      const title = typeof parsed.title === 'string' && parsed.title !== LEGACY_ROOT_LABEL ? parsed.title : ROOT_LABEL;

      return {
        title,
        ...(typeof parsed.icon === 'string' && { icon: parsed.icon }),
      };
    }
  } catch {
    // Unreadable storage: the default below.
  }

  return { title: ROOT_LABEL };
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

  private rootPage: RootRecord = readRoot();

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

  /** The root document's title and icon. */
  public root(): RootRecord {
    return this.rootPage;
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

    const above = this.trail(pageId).slice(0, -1).map((entry) => untitled(entry.title));

    return {
      title: page.title,
      ...(page.icon !== undefined && { icon: { type: 'emoji' as const, value: page.icon } }),
      path: [untitled(this.rootPage.title), ...above],
    };
  }

  public create(pageId: string, parentId: string | null): void {
    if (this.has(pageId)) {
      return;
    }
    this.pages[pageId] = { title: '', parentId, blocks: [] };
    this.persist();
  }

  /**
   * Gives a page a record when a link to it is followed. Another tab of this
   * browser may have stored it after this registry was read; else the page
   * came from a peer, and the link is all this browser knows about it.
   */
  public adopt(pageId: string, link: { parentId: string | null; title: string; icon?: string }): void {
    if (this.has(pageId)) {
      return;
    }
    const stored = readStored();

    this.pages[pageId] = Object.hasOwn(stored, pageId)
      ? stored[pageId]
      : { title: link.title, parentId: link.parentId, blocks: [], ...(link.icon !== undefined && { icon: link.icon }) };
    this.persist();
  }

  /** `null` is the root document. */
  public setTitle(pageId: string | null, title: string): void {
    if (pageId === null) {
      this.editRoot({ ...this.rootPage, title });

      return;
    }
    this.edit(pageId, (page) => ({ ...page, title }));
  }

  /** `null` is the root document. */
  public setIcon(pageId: string | null, icon: string | undefined): void {
    const withIcon = <T extends RootRecord>({ icon: _old, ...page }: T): Omit<T, 'icon'> & { icon?: string } =>
      icon === undefined ? page : { ...page, icon };

    if (pageId === null) {
      this.editRoot(withIcon(this.rootPage));

      return;
    }
    this.edit(pageId, withIcon);
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
      localStorage.removeItem(ROOT_STORAGE_KEY);
    } catch {
      // Storage blocked: the in-memory reset below still applies.
    }
    this.pages = structuredClone(this.seed);
    this.rootPage = { title: ROOT_LABEL };
  }

  private editRoot(root: RootRecord): void {
    this.rootPage = root;
    try {
      const { title, ...rest } = root;

      localStorage.setItem(ROOT_STORAGE_KEY, JSON.stringify(title === ROOT_LABEL ? rest : root));
    } catch {
      // Quota or blocked storage: the title still works for this tab.
    }
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

/** What `firstBlockKeydown` needs from the editor. */
export interface FirstBlockEditor {
  blocks: {
    getBlockByIndex(index: number): { id: string; holder: HTMLElement; isEmpty: boolean } | undefined;
    getChildren(parentId: string): unknown[];
    delete(index: number, setCaret: boolean): Promise<void>;
  };
}

const placeCaret = (node: Node, offset: number): void => {
  window.getSelection()?.setPosition(node, offset);
};

const caretToTitleEnd = (title: HTMLElement): void => {
  placeCaret(title, title.childNodes.length);
};

/**
 * Backspace at the very start of the first block, or ArrowUp on its first
 * line, goes up into the title, as in Notion. Backspace also pulls the block's
 * text into the title and removes the block, unless the block has children or
 * more than one field (an image caption, a table). Returns whether it handled
 * the key.
 */
export const firstBlockKeydown = (event: KeyboardEvent, editor: FirstBlockEditor): boolean => {
  const title = document.querySelector<HTMLElement>(PAGE_TITLE_SELECTOR);
  const first = editor.blocks.getBlockByIndex(0);
  const selection = window.getSelection();
  const node = selection?.anchorNode ?? null;

  if ((event.key !== 'Backspace' && event.key !== 'ArrowUp')
    || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
    || title === null || title.contentEditable !== 'true' || first === undefined
    || selection === null || node === null || !selection.isCollapsed) {
    return false;
  }

  const field = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('[contenteditable="true"]') ?? null;

  // A block nested in the first one has its own holder in between.
  if (field === null || field.closest(`[${DATA_ATTR.element}]`) !== first.holder) {
    return false;
  }

  if (event.key === 'ArrowUp') {
    if (!isCaretAtFirstLine(field)) {
      return false;
    }

    const x = getCaretXPosition();

    event.preventDefault();
    event.stopPropagation();
    title.focus();
    if (x === null) {
      caretToTitleEnd(title);
    } else {
      setCaretAtXPosition(title, x, false);
    }

    return true;
  }

  // Measured from the caret's own field: a list marker before it is not text.
  const before = document.createRange();

  before.setStart(field, 0);
  before.setEnd(node, selection.anchorOffset);
  if (before.toString() !== '') {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();

  const movable = editor.blocks.getChildren(first.id).length === 0
    && first.holder.querySelectorAll('[contenteditable="true"]:not([data-blok-mutation-free])').length === 1;

  if (!movable) {
    title.focus();
    caretToTitleEnd(title);

    return true;
  }

  const join = (title.textContent ?? '').length;

  // Written before the title takes focus: the undo step then starts with the
  // caret in this block, and undo puts it back here.
  title.append(field.textContent ?? '');
  title.normalize();
  title.dispatchEvent(new Event('input'));
  void editor.blocks.delete(0, false);
  title.focus();
  placeCaret(title.firstChild ?? title, title.firstChild === null ? 0 : join);

  return true;
};

/**
 * Puts a peer's title into the title element without moving focus. A caret
 * in the title keeps its offset, clamped to the new text.
 */
export const replaceTitleText = (title: HTMLElement, text: string): void => {
  const selection = window.getSelection();
  const node = selection?.anchorNode ?? null;
  const caret = selection !== null && node !== null && title.contains(node) ? selection.anchorOffset : null;

  // No empty text node: the placeholder shows only on :empty.
  title.replaceChildren(...(text === '' ? [] : [text]));
  if (caret !== null && title.firstChild !== null) {
    placeCaret(title.firstChild, Math.min(caret, text.length));
  }
};

/** ArrowDown out of the title: the first block's first line, at `x` when known. */
export const caretToFirstBlock = (
  editor: {
    blocks: { getBlockByIndex(index: number): { holder: HTMLElement } | undefined };
    caret: { setToFirstBlock(position: 'start'): boolean };
  },
  x: number | null
): void => {
  editor.caret.setToFirstBlock('start');

  const holder = editor.blocks.getBlockByIndex(0)?.holder;
  const field = holder === undefined ? null : findOwn(holder, '[contenteditable="true"]:not([data-blok-mutation-free])');

  if (x !== null && field instanceof HTMLElement) {
    setCaretAtXPosition(field, x, true);
  }
};

/* ---------------------------------------------------------------- header */

export interface PageHeaderOptions {
  pageId: string | null;
  pages: PageRegistry;
  search: string;
  readOnly: boolean;
  /** Plain click on a breadcrumb. `link` is the crumb: the page opens from it. */
  navigate(pageId: string | null, link: HTMLElement): void;
  /** Enter in the title: open a new first block holding `html`, the title's text after the caret. */
  splitTitle(html: string): void;
  /** ArrowDown on the title's last line; `x` is the caret's, when known. */
  toFirstBlock(x: number | null): void;
  /** The title changed by the user: `typing` continues an undo step, otherwise it is one of its own. */
  recordTitle(text: string, typing: boolean): void;
  /** Cmd+Z in the title. */
  undo(): void;
  /** Cmd+Shift+Z or Ctrl+Y in the title. */
  redo(): void;
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

const pageLinks = (pageId: string): string[] => {
  const path = CSS.escape(`/editor/page/${encodeURIComponent(pageId)}`);

  return [`[href="${path}"]`, `[href^="${path}?"]`].map((link) => `[data-blok-testid="page-link"]${link}`);
};

/** A part (`page-title` or `page-icon`) of the page block for `pageId`, as the parent page renders it. */
export const pageLinkSelector = (pageId: string, part = 'page-title'): string =>
  pageLinks(pageId).map((link) => `${link} [data-blok-testid="${part}"]`).join(', ');

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

/** Draws the header of the page being shown, the root document included. Hidden for an unknown page. */
export const renderPageHeader = (host: HTMLElement, options: PageHeaderOptions): void => {
  const { pageId, pages, search } = options;
  const page = pageId === null ? pages.root() : pages.get(pageId);
  const currentIcon = (): string | undefined => (pageId === null ? pages.root() : pages.get(pageId))?.icon;

  closeIconPicker();

  if (page === undefined) {
    host.toggleAttribute('hidden', true);
    host.replaceChildren();

    return;
  }

  host.toggleAttribute('hidden', false);

  const nav = document.createElement('nav');
  const list = document.createElement('ol');

  nav.className = 'pg-crumbs';
  nav.setAttribute('aria-label', 'Breadcrumb');

  const root = pages.root();
  const trail = pageId === null ? [] : pages.trail(pageId);
  const items: Array<{ id: string | null; el: HTMLElement }> = [
    { id: null, el: crumb(untitled(root.title), root.icon, pageId === null ? null : pagePath(null, search)) },
    ...trail.map((entry) => ({
      id: entry.id,
      el: crumb(untitled(entry.title), entry.icon, entry.id === pageId ? null : pagePath(entry.id, search)),
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
        options.navigate(id, el);
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
    const icon = currentIcon();

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

  const openPicker = (): void => {
    const { i18n, locale } = options.i18n();

    openIconPicker(iconButton, i18n, locale, (native) => setIcon(native), () => setIcon(undefined));
  };

  iconButton.addEventListener('click', () => {
    if (currentIcon() !== undefined) {
      openPicker();

      return;
    }
    void randomIcon().then((icon) => {
      setIcon(icon);
      openPicker();
    }, openPicker);
  });
  drawIcon();
  if (currentIcon() === undefined) {
    // Loaded now so the click's random pick resolves at once.
    void loadEmojiGrid().catch(() => undefined);
  }
  iconRow.append(iconButton);

  const title = document.createElement('h1');

  title.id = PAGE_TITLE_SELECTOR.slice(1);
  title.className = 'pg-page-title';
  title.textContent = page.title;
  title.setAttribute('data-placeholder', 'New page');
  title.setAttribute('role', 'textbox');
  title.setAttribute('aria-label', 'Page title');
  title.spellcheck = false;
  title.contentEditable = options.readOnly ? 'false' : 'true';

  // Keystrokes arrive as InputEvents; our own writes (paste, Enter, Backspace
  // from the first block) dispatch a plain Event, so each is an undo step.
  title.addEventListener('input', (event) => {
    const text = (title.textContent ?? '').replace(/\n/g, ' ');

    // A stray <br> left by the browser would hide the placeholder.
    if (text === '') {
      title.replaceChildren();
    }
    pages.setTitle(pageId, text);
    options.recordTitle(text, event instanceof InputEvent);
    if (currentText !== null) {
      currentText.textContent = untitled(text);
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
    const letter = event.key.toLowerCase();
    const redo = ((event.metaKey || event.ctrlKey) && event.shiftKey && letter === 'z')
      || (event.ctrlKey && !event.shiftKey && letter === 'y');

    if (redo || ((event.metaKey || event.ctrlKey) && !event.shiftKey && letter === 'z')) {
      event.preventDefault();
      if (redo) {
        options.redo();
      } else {
        options.undo();
      }

      return;
    }
    if (event.key === 'ArrowDown' && !event.isComposing && !event.shiftKey && isCaretAtLastLine(title)) {
      event.preventDefault();
      options.toFirstBlock(getCaretXPosition());

      return;
    }
    if (event.key !== 'Enter' || event.isComposing) {
      return;
    }
    event.preventDefault();

    const range = window.getSelection()?.getRangeAt(0);

    if (range === undefined || !title.contains(range.commonAncestorContainer)) {
      return;
    }
    range.deleteContents();
    range.setEnd(title, title.childNodes.length);

    const rest = document.createElement('div');

    rest.append(range.extractContents());
    title.normalize();
    title.dispatchEvent(new Event('input'));
    options.splitTitle(rest.innerHTML);
  });

  const trashed = pageId === null ? null : pages.trashedIn(pageId);
  const banner = pageId === null || trashed === null ? [] : [trashBanner(trashed, pageId, options)];

  const crumbs = pageId === null ? [] : [nav];

  host.replaceChildren(...banner, ...crumbs, iconRow, title);
};

const trashBanner = (trashed: PageRecord & { id: string }, pageId: string, options: PageHeaderOptions): HTMLElement => {
  const banner = document.createElement('div');
  const text = document.createElement('p');
  const name = untitled(trashed.title);

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

const randomIcon = async (): Promise<string> => {
  const emojis = await loadEmojiGrid();
  const emoji = emojis[Math.floor(Math.random() * emojis.length)];

  if (emoji === undefined) {
    throw new Error('No emojis to pick from');
  }

  return emoji.native;
};

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
    pickerSlot.current = { instance: new EmojiPicker({ onSelect, onRemove, i18n, locale, curated: false, startInset: 0 }), i18n, locale };
  }

  const element = pickerSlot.current.instance.getElement();

  if (!element.isConnected) {
    document.body.append(element);
  }

  // The picker has no close callback; it hides its root on close.
  const watch = new MutationObserver(() => {
    if (element.hidden) {
      anchor.setAttribute('aria-expanded', 'false');
      watch.disconnect();
    }
  });

  anchor.setAttribute('aria-expanded', 'true');
  watch.observe(element, { attributes: true, attributeFilter: ['hidden'] });
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

/** The elements of one page end that morph into the other end's. */
export interface PageMorph {
  title: string;
  icon: string;
}

export const PAGE_HEADER_MORPH: PageMorph = { title: PAGE_TITLE_SELECTOR, icon: '.pg-page-icon' };

/** The page block for `pageId`, as the parent page renders it. */
export const pageLinkMorph = (pageId: string): PageMorph => ({
  title: pageLinkSelector(pageId),
  icon: pageLinkSelector(pageId, 'page-icon'),
});

export interface PageTransitionOptions {
  direction: 'forward' | 'back';
  /** The page being left. */
  from: PageMorph | null;
  to: PageMorph | null;
  /**
   * Viewport point of a link outside the editor (the page tree, a crumb).
   * The new page then grows out of it instead of morphing parts.
   */
  origin?: { x: number; y: number };
}

/*
 * Two elements with one name make the browser skip the whole transition, and
 * a page can be linked twice, so a part that matches more than once stays unnamed.
 */
const morphRules = (morph: PageMorph | null): string => {
  if (morph === null) {
    return '';
  }

  return (['title', 'icon'] as const)
    .filter((part) => document.querySelectorAll(morph[part]).length === 1)
    .map((part) => `${morph[part]} { view-transition-name: pg-page-${part}; }`)
    .join('\n');
};

/*
 * The leaving and arriving bodies get different names. One shared name would
 * animate the body's box from the old scroll offset to the new one, sliding
 * the page by the whole scroll distance.
 */
const bodyRule = (side: 'out' | 'in'): string => `#tab-editor { view-transition-name: pg-page-${side}; }`;

/*
 * A body snapshot is as tall as the whole page, so scaling it around its own
 * middle would slide what is on screen. Scale around the viewport's middle.
 */
const setBodyOrigin = (side: 'out' | 'in'): void => {
  const top = document.getElementById('tab-editor')?.getBoundingClientRect().top ?? 0;

  document.documentElement.style.setProperty(`--pg-page-${side}-origin`, `50% ${Math.round(window.innerHeight / 2 - top)}px`);
};

/*
 * Body snapshots span the whole page, so the click point is set against each
 * body's own box: before the swap for the old one, after the scroll restore
 * for the new one.
 */
const setPortalPoint = (side: 'out' | 'in', origin: { x: number; y: number }): void => {
  const box = document.getElementById('tab-editor')?.getBoundingClientRect();

  document.documentElement.style.setProperty(
    `--pg-portal-${side}`,
    `${Math.round(origin.x - (box?.left ?? 0))}px ${Math.round(origin.y - (box?.top ?? 0))}px`
  );
};

/* The reveal must reach the farthest corner of the screen from the click. */
const portalReach = (origin: { x: number; y: number }): string => {
  const dx = Math.max(origin.x, window.innerWidth - origin.x);
  const dy = Math.max(origin.y, window.innerHeight - origin.y);

  return `${Math.ceil(Math.hypot(dx, dy))}px`;
};

/* A page that came back shorter (a peer deleted blocks) must not keep a blank tail forever. */
const HOLD_LIMIT_MS = 4000;

/**
 * Keeps the document `height` tall until the content fills it again, so
 * restoring a scroll offset on a page that is still loading is not clamped.
 */
export const holdPageHeight = (height: number): void => {
  const root = document.documentElement;
  const release = (): void => {
    watch.disconnect();
    clearTimeout(timer);
    root.style.removeProperty('min-height');
  };
  const watch = new ResizeObserver(() => {
    if (document.body.getBoundingClientRect().height >= height) {
      release();
    }
  });
  const timer = setTimeout(release, HOLD_LIMIT_MS);

  root.style.setProperty('min-height', `${height}px`);
  watch.observe(document.body);
};

/*
 * Must stay under Chrome's 4s update-callback abort. Navigation swaps also pass
 * it as the loader delay, so a page that loads in time never paints a skeleton.
 */
export const PAGE_CONTENT_WAIT_MS = 1200;

/**
 * Resolves once the editor in `holder` shows its blocks and the loading
 * skeleton has let go, or at `limitMs`. Inside a transition's update this
 * makes the new snapshot the real page, and keeps the heavy first render
 * off the animation's main thread.
 */
export const waitForPageContent = (holder: HTMLElement, limitMs: number): Promise<void> => new Promise((resolve) => {
  const ready = (): boolean => holder.querySelector('[data-blok-element]') !== null && holder.querySelector('[data-blok-loading]') === null;

  // No frame yield here: rAF never fires while a transition's update is pending.
  if (ready()) {
    resolve();

    return;
  }

  const finish = (): void => {
    watch.disconnect();
    clearTimeout(timer);
    resolve();
  };
  const watch = new MutationObserver(() => {
    if (ready()) {
      finish();
    }
  });
  const timer = setTimeout(finish, limitMs);

  watch.observe(holder, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-blok-loading'] });
});

/**
 * Which parts morph on a page change. Going down, the row grows into the
 * header; going up to the direct parent, the header shrinks back into its row.
 * Any other jump has no row for the page, so nothing morphs.
 */
export const pageNavMorphs = (nav: {
  back: boolean;
  from: string | null;
  target: string | null;
  parentOf: (pageId: string) => string | null | undefined;
}): { from: PageMorph | null; to: PageMorph | null } => {
  if (!nav.back) {
    return nav.target === null ? { from: null, to: null } : { from: pageLinkMorph(nav.target), to: PAGE_HEADER_MORPH };
  }

  if (nav.from !== null && nav.parentOf(nav.from) === nav.target) {
    return { from: PAGE_HEADER_MORPH, to: pageLinkMorph(nav.from) };
  }

  return { from: null, to: null };
};

/**
 * A soft gray wash that fades off the row of the page just left, so the eye
 * lands where it came from. An animation, not a class: Blok's DOM stays untouched.
 */
export const flashArrivalRow = (pageId: string): void => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  const link = document.querySelector<HTMLElement>(pageLinks(pageId).join(', '));

  link?.animate(
    [{ backgroundColor: 'var(--blok-item-hover-bg)' }, { backgroundColor: 'var(--blok-item-hover-bg)', offset: 0.35 }, { backgroundColor: 'transparent' }],
    { duration: 1100, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }
  );
};

/**
 * Runs `update` inside a view transition: the body slides, and the `from`
 * title and icon morph into the `to` ones (a page row into the page header).
 * Instant when the API is missing or the user asked for reduced motion.
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

  morph.textContent = [bodyRule('out'), morphRules(options.from)].join('\n');
  document.head.append(morph);
  root.classList.add('pg-page-nav');
  root.setAttribute('data-pg-page-dir', options.direction);
  setBodyOrigin('out');
  if (options.origin !== undefined) {
    root.setAttribute('data-pg-page-via', 'portal');
    root.style.setProperty('--pg-portal-reach', portalReach(options.origin));
    setPortalPoint('out', options.origin);
  }

  const transition = document.startViewTransition(async () => {
    await update();
    morph.textContent = [bodyRule('in'), morphRules(options.to)].join('\n');
    setBodyOrigin('in');
    if (options.origin !== undefined) {
      setPortalPoint('in', options.origin);
    }
  });

  try {
    await transition.updateCallbackDone;
    await transition.finished;
  } catch {
    // A skipped transition (a hidden tab, a named element replaced mid-way) still ran update.
  } finally {
    morph.remove();
    root.classList.remove('pg-page-nav');
    root.removeAttribute('data-pg-page-dir');
    root.removeAttribute('data-pg-page-via');
    ['--pg-page-out-origin', '--pg-page-in-origin', '--pg-portal-out', '--pg-portal-in', '--pg-portal-reach'].forEach((name) => root.style.removeProperty(name));
  }
};

/* ------------------------------------------------------------------ seed */

/**
 * Pages the root playground document links to (`playground-document.json` uses these ids).
 * `yarn serve` seeds their collaboration rooms from the same file.
 */
export const SEED_PAGES = seedPages as PageMap;

/**
 * Puts the header over the editor's text column. The column's offset comes
 * from the editor's own gutter (block controls), which depends on toolbar
 * side, direction and width, so it is measured, not copied into CSS.
 */
export const alignPageHeader = (header: HTMLElement, holder: HTMLElement): void => {
  const content = holder.querySelector('[data-blok-element-content]');
  const column = header.parentElement;

  if (header.hidden || column === null) {
    return;
  }

  /*
   * Before the first block renders there is nothing to measure, and the CSS
   * fallback column ignores the gutter, so the header would jump sideways.
   * Hide it until the first measurement; later re-renders keep the last one.
   */
  if (content === null) {
    if (header.style.marginLeft === '') {
      header.style.setProperty('visibility', 'hidden');
    }

    return;
  }

  const box = content.getBoundingClientRect();

  header.style.setProperty('margin-left', `${Math.round(box.left - column.getBoundingClientRect().left)}px`);
  header.style.setProperty('max-width', `${Math.round(box.width)}px`);
  header.style.removeProperty('visibility');
};

/**
 * Re-aligns whenever the editor box changes size. A collaborative document
 * renders after `isReady`, so a one-off measurement finds no blocks yet.
 */
export const keepPageHeaderAligned = (header: HTMLElement, holder: HTMLElement): void => {
  new ResizeObserver(() => alignPageHeader(header, holder)).observe(holder);
};
