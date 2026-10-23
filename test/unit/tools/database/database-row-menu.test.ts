import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rowMenuItems } from '../../../../src/tools/database/database-table-menus';
import type { RowMenuContext } from '../../../../src/tools/database/database-table-menus';
import { DatabaseTableView, createTableState } from '../../../../src/tools/database/database-table-view';
import type { DatabaseTableViewOptions, TableHandlers } from '../../../../src/tools/database/database-table-view';
import { IconArrowDiagonal, IconListBulleted, IconPreview } from '../../../../src/components/icons';
import { beautifyShortcut } from '../../../../src/components/utils/string';
import type { DatabaseRow, PropertyDefinition } from '../../../../src/tools/database/types';

interface Item {
  title?: string;
  icon?: string | HTMLElement;
  type?: string;
  secondaryLabel?: string;
  element?: HTMLElement;
  onActivate?: (item: never, event: undefined) => void;
  children?: { items?: Item[] };
}

const context = (overrides: Partial<RowMenuContext> = {}): RowMenuContext => ({
  i18n: { t: (key: string, vars?: Record<string, string | number>) => (vars?.name !== undefined ? `${key}:${vars.name}` : key) },
  properties: [],
  onEditIcon: vi.fn(),
  onEditProperty: vi.fn(),
  onOpenIn: vi.fn(),
  onCopyLink: vi.fn(),
  onDuplicate: vi.fn(),
  onDelete: vi.fn(),
  ...overrides,
});

const items = (ctx: RowMenuContext): Item[] => rowMenuItems(ctx);
const named = (list: Item[], title: string): Item => {
  const item = list.find((i) => i.title === title);

  if (item === undefined) throw new Error(`no ${title} in ${list.map((i) => i.title ?? i.type).join(',')}`);

  return item;
};

describe('row ⋮⋮ menu (research/08)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('Open in offers Side peek, Center peek and Full page', () => {
    const ctx = context();
    const openIn = named(items(ctx), 'tools.database.tableOpenIn').children?.items ?? [];

    expect(openIn.map((i) => i.title)).toEqual(['tools.database.openPagesSide', 'tools.database.openPagesCenter', 'tools.database.openPagesFull']);
    openIn[1].onActivate?.(undefined as never, undefined);
    openIn[2].onActivate?.(undefined as never, undefined);
    expect(ctx.onOpenIn).toHaveBeenNthCalledWith(1, 'center');
    expect(ctx.onOpenIn).toHaveBeenNthCalledWith(2, 'full');
  });

  it('Move to Trash shows its key through the shared shortcut formatter', () => {
    expect(named(items(context()), 'tools.database.tableMoveToTrash').secondaryLabel).toBe(beautifyShortcut('DELETE'));
  });

  it('Move to lists the other databases, after Duplicate', () => {
    const onMoveTo = vi.fn();
    const list = items(context({ moveTargets: [{ id: 'db2', title: 'Projects' }, { id: 'db3', title: '' }], onMoveTo }));
    const titles = list.map((i) => i.title);
    const move = named(list, 'tools.database.tableMoveTo');

    expect(titles.indexOf('tools.database.tableMoveTo')).toBe(titles.indexOf('tools.database.tableDuplicate') + 1);
    expect(move.children?.items?.map((i) => i.title)).toEqual(['Projects', 'tools.database.relationUntitledDatabase']);
    move.children?.items?.[0].onActivate?.(undefined as never, undefined);
    expect(onMoveTo).toHaveBeenCalledWith('db2');
  });

  it('has no Move to when no other database can take the row', () => {
    expect(items(context({ moveTargets: [], onMoveTo: vi.fn() })).map((i) => i.title)).not.toContain('tools.database.tableMoveTo');
  });

  it('Comment and Move to show their keys through the shared shortcut formatter', () => {
    const list = items(context({ onComment: vi.fn(), moveTargets: [{ id: 'db2', title: 'Projects' }], onMoveTo: vi.fn() }));

    expect(named(list, 'tools.database.tableComment').secondaryLabel).toBe(beautifyShortcut('CMD+SHIFT+M'));
    expect(named(list, 'tools.database.tableMoveTo').secondaryLabel).toBe(beautifyShortcut('CMD+SHIFT+P'));
  });

  it('the footer counts the words and characters of the row', () => {
    const t = (key: string, vars?: Record<string, string | number>): string => (vars === undefined ? key : `${key}:${JSON.stringify(vars)}`);
    const list = items(context({ i18n: { t }, counts: { words: 1, characters: 5 } }));
    const footer = list[list.length - 1];

    expect(footer.type).toBe('html');
    expect(footer.element?.textContent).toContain('tools.database.rowWordCount:{"words":1,"characters":5}');
  });

  it('has no Add to Favorites without the host favorites lever', () => {
    const titles = items(context()).map((i) => i.title);

    expect(titles).not.toContain('tools.database.rowAddToFavorites');
    expect(titles).not.toContain('tools.database.rowRemoveFromFavorites');
  });

  it('Add to Favorites comes first under "Page", before Edit icon (research/08)', () => {
    const onToggle = vi.fn();
    const list = items(context({ favorite: { on: false, onToggle } }));

    expect(list[1].title).toBe('tools.database.rowAddToFavorites');
    expect(list[2].title).toBe('tools.database.tableEditIcon');
    list[1].onActivate?.(undefined as never, undefined);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('a favorite row offers Remove from Favorites', () => {
    const list = items(context({ favorite: { on: true, onToggle: vi.fn() } }));

    expect(list[1].title).toBe('tools.database.rowRemoveFromFavorites');
  });

  it('with only the favorite under "Page", a line still follows it', () => {
    const list = items(context({ onEditIcon: undefined, onEditProperty: undefined, favorite: { on: false, onToggle: vi.fn() } }));

    expect(list.slice(1, 4).map((i) => i.title ?? i.type)).toEqual(['tools.database.rowAddToFavorites', 'separator', 'tools.database.tableOpenIn']);
  });

  // feel findings B15, 09-notion-card-menu.png.
  it('draws Notion\'s glyphs: a bulleted list, an open eye and an up-right arrow', () => {
    const list = items(context({ onLayout: vi.fn(), onPropertyVisibility: vi.fn() }));

    expect(named(list, 'tools.database.tableEditProperty').icon).toBe(IconListBulleted);
    expect(named(list, 'tools.database.settingsPropertyVisibility').icon).toBe(IconPreview);
    expect(named(list, 'tools.database.tableOpenIn').icon).toBe(IconArrowDiagonal);
  });

  it('sets Layout and Property visibility apart from Edit property with a line', () => {
    const list = items(context({ onLayout: vi.fn(), onPropertyVisibility: vi.fn() }));
    const at = list.findIndex((i) => i.title === 'tools.database.tableEditProperty');

    expect(list.slice(at, at + 3).map((i) => i.title ?? i.type)).toEqual(['tools.database.tableEditProperty', 'separator', 'tools.database.settingsLayout']);
    expect(items(context()).findIndex((i) => i.title === 'tools.database.tableEditProperty') + 1)
      .toBe(items(context()).findIndex((i) => i.type === 'separator'));
  });

  it('ends with a "Last edited by" footer when the row knows who edited it', () => {
    const list = items(context({ lastEdited: { name: 'Jack', time: 'today 3:02 AM' } }));
    const footer = list[list.length - 1];

    expect(footer.type).toBe('html');
    expect(footer.element?.textContent).toContain('tools.database.rowLastEditedBy:Jack');
    expect(footer.element?.textContent).toContain('today 3:02 AM');
    expect(items(context()).some((i) => i.element?.hasAttribute('data-blok-database-row-menu-footer') === true)).toBe(false);
  });
});

describe('row ⋮⋮ menu in the table', () => {
  const schema: PropertyDefinition[] = [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }];
  const rows: DatabaseRow[] = [{ id: 'r1', position: 'a0', properties: { 'p-title': 'Alpha' }, meta: { lastEditedBy: 'u1', lastEditedAt: Date.parse('2026-10-09T03:02:00') } }];

  const mount = (handlers: Partial<TableHandlers> = {}, extra: Partial<DatabaseTableViewOptions> = {}): HTMLElement => {
    const view = new DatabaseTableView({
      readOnly: false,
      i18n: { t: (key: string, vars?: Record<string, string | number>) => (vars === undefined ? key : `${key}:${Object.values(vars).join(',')}`) } as DatabaseTableViewOptions['i18n'],
      view: { id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] },
      schema,
      rows,
      titlePropertyId: 'p-title',
      state: createTableState(),
      locale: 'en-US',
      cellContext: { people: [{ id: 'u1', name: 'Jack Uait' }], now: new Date('2026-10-09T15:00:00') },
      handlers: { openRow: vi.fn(), ...handlers } as unknown as TableHandlers,
      ...extra,
    });
    const root = view.createView();

    document.body.appendChild(root);

    return root;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('searches with the "Search actions…" placeholder and shows who edited the row last', () => {
    const root = mount();

    root.querySelector<HTMLElement>('[data-row-id="r1"] [data-blok-database-table-row-handle]')?.click();
    const search = document.querySelector<HTMLInputElement>('[data-blok-popover-opened] input');

    expect(search?.placeholder).toBe('tools.database.searchActions');
    expect(document.querySelector('[data-blok-database-row-menu-footer]')?.textContent).toContain('tools.database.rowLastEditedBy:Jack Uait');
  });

  it('writes an edit from today as "Today at <time>" (research/35 §19)', () => {
    const root = mount({}, { cellContext: { people: [{ id: 'u1', name: 'Jack Uait' }], now: new Date('2026-10-09T15:00:00'), hourCycle: 'h12' } });

    root.querySelector<HTMLElement>('[data-row-id="r1"] [data-blok-database-table-row-handle]')?.click();
    const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hourCycle: 'h12' }).format(new Date('2026-10-09T03:02:00'));

    expect(document.querySelector('[data-blok-database-row-menu-footer]')?.textContent).toContain(`tools.database.rowEditedTodayAt:${time}`);
  });

  it('the footer counts the words and characters of the row title', () => {
    const root = mount();

    root.querySelector<HTMLElement>('[data-row-id="r1"] [data-blok-database-table-row-handle]')?.click();

    expect(document.querySelector('[data-blok-database-row-menu-footer]')?.textContent).toContain('tools.database.rowWordCount:1,5');
  });

  it('Add to Favorites asks the host on each open and hands it the next state', () => {
    const favorites = new Set<string>();
    const toggle = vi.fn((rowId: string, next: boolean) => (next ? favorites.add(rowId) : favorites.delete(rowId)));
    const root = mount({}, { favorite: (rowId) => ({ on: favorites.has(rowId), onToggle: () => toggle(rowId, !favorites.has(rowId)) }) });
    const open = (): HTMLElement | undefined => {
      root.querySelector<HTMLElement>('[data-row-id="r1"] [data-blok-database-table-row-handle]')?.click();

      return document.querySelector<HTMLElement>('[data-blok-popover-opened] [data-blok-testid="popover-item-title"]') ?? undefined;
    };

    const first = open();

    expect(first?.textContent).toBe('tools.database.rowAddToFavorites');
    first?.click();
    expect(toggle).toHaveBeenCalledWith('r1', true);
    expect(open()?.textContent).toBe('tools.database.rowRemoveFromFavorites');
  });

  it('Move to shows its key on screen next to its chevron', () => {
    const root = mount({ moveRowTo: vi.fn(), moveTargets: () => [{ id: 'db2', title: 'Projects' }] });

    root.querySelector<HTMLElement>('[data-row-id="r1"] [data-blok-database-table-row-handle]')?.click();
    const move = [...document.querySelectorAll<HTMLElement>('[data-blok-popover-opened] [data-blok-testid="popover-item-title"]')]
      .find((title) => title.textContent === 'tools.database.tableMoveTo')?.parentElement;

    expect(move?.querySelector('[data-blok-testid="popover-item-secondary-title"]')).not.toBeNull();
  });
});
