import type { API } from '../../../types';
import { PagePicker } from '../page/page-picker';
import { searchVisiblePages } from '../page/search-pages';
import type { PageConfig } from '../page/types';
import { DATABASE_MENU_CLASS } from './database-group-menu';

/** Marks a database row in the picker's page list; a host page id that starts with it is dropped. */
const DATABASE_KEY = 'database\u0000';

/** notion-motion.md Round 62 §1: 330 wide. */
const PICKER_WIDTH = '330px';

/** Its top sits 6px below the row menu's top (Round 62 §1). */
export const MOVE_PICKER_DROP = 6;

export interface MovePickerOptions {
  i18n: API['i18n'];
  /** Escape gives focus back here. */
  anchor: HTMLElement;
  /** The top-left corner, moving with `positionContext`. */
  at: { position: DOMRect; positionContext: HTMLElement };
  /**
   * Where a query moves the box (notion-motion.md Round 63 §2): `position()` is
   * 1px under the right-click point, or with `above` the box's bottom sits on
   * the point. Without it the box stays put.
   */
  searchAt?: { position: () => DOMRect; above: boolean };
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
    if (query !== '' && options.searchAt !== undefined) {
      picker.place(options.searchAt.position(), options.at.positionContext, options.searchAt.above ? 1 : undefined);
    }
  };

  picker.open('', options.anchor, (pageId) => {
    if (pageId.startsWith(DATABASE_KEY)) {
      options.onDatabase(pageId.slice(DATABASE_KEY.length));

      return;
    }
    options.onPage(pageId, titles.get(pageId) || t('tools.page.unresolved'));
  }, {
    searchField: { placeholder: t('tools.database.moveToPlaceholder'), onQuery: (query) => void show(query) },
    popover: { class: `${DATABASE_MENU_CLASS} blok-database-move-menu`, width: PICKER_WIDTH, at: options.at },
    sections: { idle: t('tools.database.linkedSuggested'), query: t('tools.database.moveToPages') },
    highlightIdle: false,
    showAll: true,
  });
  picker.getElement()?.setAttribute('data-blok-database-move-picker', '');
  picker.startSearch('');
  void show('');

  return picker;
};
