import type { API } from '../../../types';
import { PagePicker } from '../page/page-picker';
import { searchVisiblePages, visibleChildPages } from '../page/search-pages';
import type { PageConfig } from '../page/types';
import { DATABASE_MENU_CLASS } from './database-group-menu';

/** Marks a database row in the picker's page list; a host page id that starts with it is dropped. */
const DATABASE_KEY = 'database\u0000';

/** notion-motion.md Round 62 §1: 330 wide. */
const PICKER_WIDTH = '330px';

/** Without a pointer, its top sits 6px below the row menu's top (Round 62 §1). */
const MENU_DROP = 6;

/** notion-motion.md Round 64 §3: the box keeps 12 from the window's edges. */
const WINDOW_MARGIN = 12;

/** Where the picker opens. Read when it opens, so a scroll since then does not leave it behind. */
export type MovePickerFrom =
  /** A right-click on `on`: the point and `on`'s box at that moment. */
  | { pointer: { x: number; y: number; on: HTMLElement; was: DOMRect } }
  /** The row menu's box: its left, 6px below its top. Unmeasured for a ⋮⋮ or ⋯ menu. */
  | { menu: DOMRect }
  /** Under this element's bottom-left corner. */
  | { under: HTMLElement };

/** A right-click on `on`, for {@link MovePickerFrom}. */
export const pointerFrom = (on: HTMLElement, event: Pick<MouseEvent, 'clientX' | 'clientY'>): MovePickerFrom => ({
  pointer: { x: event.clientX, y: event.clientY, on, was: on.getBoundingClientRect() },
});

/** The row menu's box, or under `element` when no menu is open. */
export const menuFrom = (menu: DOMRect | undefined, element: HTMLElement): MovePickerFrom => (menu !== undefined ? { menu } : { under: element });

/** The box's top-left corner when it fits under it. */
const cornerOf = (from: MovePickerFrom): DOMRect => {
  if ('pointer' in from) {
    const { x, y, on, was } = from.pointer;
    const now = on.isConnected ? on.getBoundingClientRect() : was;

    return new DOMRect(x + now.left - was.left, y + 1 + now.top - was.top, 0, 0);
  }
  if ('menu' in from) return new DOMRect(from.menu.left, from.menu.top + MENU_DROP, 0, 0);
  const box = from.under.getBoundingClientRect();

  return new DOMRect(box.left, box.bottom, 0, 0);
};

export interface MovePickerOptions {
  i18n: API['i18n'];
  /** Escape gives focus back here. */
  anchor: HTMLElement;
  /** The box moves with it. */
  context: HTMLElement;
  /**
   * Where the box goes (notion-motion.md Round 64 §3): its top-left 1px under a
   * right-click when it fits, else above with its bottom on the point when its
   * top keeps 12, else clamped 12 over the window bottom. A query's box, which
   * fits its content, follows the same rule as it resizes.
   */
  from: MovePickerFrom;
  /** The document's other databases, read on each query. */
  databases: () => ReadonlyArray<{ id: string; title: string }>;
  /** The page tool whose host takes moved pages, or null. */
  pages: PageConfig | null;
  onDatabase: (databaseId: string) => void;
  onPage: (pageId: string, title: string) => void;
}

/**
 * The "Move page to…" picker (notion-motion.md Round 62 §1): a search field,
 * "Suggested" (the host's `search('')`, after the document's other databases)
 * and "Pages" once something is typed. Nothing is highlighted until a key or
 * the pointer picks a row; a typed query highlights the first.
 */
export const openMovePicker = (options: MovePickerOptions): PagePicker => {
  const t = (key: string, vars?: Record<string, string | number>): string => options.i18n.t(key, vars);
  const picker = new PagePicker(t('tools.database.tableMoveTo'), t('tools.page.unresolved'), t('tools.page.draft'), t('tools.database.relationNoResults'), t);
  const search = { token: 0 };
  const titles = new Map<string, string>();
  // Apart from `titles`, which each query clears.
  const treeTitles = new Map<string, string>();
  const host = options.pages;
  const untitled = t('tools.database.relationUntitledDatabase');
  const show = async (query: string): Promise<void> => {
    const token = ++search.token;
    const needle = query.trim().toLowerCase();
    const databases = options.databases()
      .map((database) => ({ pageId: `${DATABASE_KEY}${database.id}`, title: database.title === '' ? untitled : database.title, kind: 'database' as const }))
      .filter((database) => database.title.toLowerCase().includes(needle));
    const pages = options.pages === null ? [] : await searchVisiblePages(options.pages, query).catch((): [] => []);

    if (token !== search.token || !picker.opened) return;
    const results = [...databases, ...pages.filter((page) => !page.pageId.startsWith(DATABASE_KEY))];

    titles.clear();
    results.forEach((result) => titles.set(result.pageId, result.title ?? ''));
    // Set with the results, not on the keystroke, so the rows change look when they change.
    picker.getElement()?.toggleAttribute('data-blok-database-move-searched', query !== '');
    picker.setResults(results);
  };

  picker.open('', options.anchor, (pageId) => {
    if (pageId.startsWith(DATABASE_KEY)) {
      options.onDatabase(pageId.slice(DATABASE_KEY.length));

      return;
    }
    options.onPage(pageId, titles.get(pageId) || treeTitles.get(pageId) || t('tools.page.unresolved'));
  }, {
    searchField: { placeholder: t('tools.database.moveToPlaceholder'), onQuery: (query) => void show(query) },
    popover: {
      class: `${DATABASE_MENU_CLASS} blok-database-move-menu`,
      width: PICKER_WIDTH,
      at: { position: cornerOf(options.from), positionContext: options.context, flipBy: 1, margin: WINDOW_MARGIN },
    },
    sections: { idle: t('tools.database.linkedSuggested'), query: t('tools.database.moveToPages') },
    highlightIdle: false,
    showAll: true,
    ...(host?.children === undefined ? {} : {
      tree: {
        label: t('tools.database.moveToWorkspace'),
        children: async (pageId: string | null) => {
          const pages = (await visibleChildPages(host, pageId)).filter((page) => !page.pageId.startsWith(DATABASE_KEY));

          pages.forEach((page) => treeTitles.set(page.pageId, page.title ?? ''));

          return pages;
        },
      },
    }),
  });
  picker.getElement()?.setAttribute('data-blok-database-move-picker', '');
  picker.startSearch('');
  void show('');

  return picker;
};
