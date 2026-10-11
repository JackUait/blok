import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rowMenuItems } from '../../../../src/tools/database/database-table-menus';
import type { RowMenuContext } from '../../../../src/tools/database/database-table-menus';
import { DatabaseTableView, createTableState } from '../../../../src/tools/database/database-table-view';
import type { DatabaseTableViewOptions, TableHandlers } from '../../../../src/tools/database/database-table-view';
import { beautifyShortcut } from '../../../../src/components/utils/string';
import type { DatabaseRow, PropertyDefinition } from '../../../../src/tools/database/types';

interface Item {
  title?: string;
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

  it('ends with a "Last edited by" footer when the row knows who edited it', () => {
    const list = items(context({ lastEdited: { name: 'Jack', time: 'today 3:02 AM' } }));
    const footer = list[list.length - 1];

    expect(footer.type).toBe('html');
    expect(footer.element?.textContent).toContain('tools.database.rowLastEditedBy:Jack');
    expect(footer.element?.textContent).toContain('today 3:02 AM');
    expect(items(context()).some((i) => i.type === 'html')).toBe(false);
  });
});

describe('row ⋮⋮ menu in the table', () => {
  const schema: PropertyDefinition[] = [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }];
  const rows: DatabaseRow[] = [{ id: 'r1', position: 'a0', properties: { 'p-title': 'Alpha' }, meta: { lastEditedBy: 'u1', lastEditedAt: Date.parse('2026-10-09T03:02:00') } }];

  const mount = (handlers: Partial<TableHandlers> = {}): HTMLElement => {
    const view = new DatabaseTableView({
      readOnly: false,
      i18n: { t: (key: string, vars?: Record<string, string | number>) => (vars?.name !== undefined ? `${key}:${vars.name}` : key) } as DatabaseTableViewOptions['i18n'],
      view: { id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] },
      schema,
      rows,
      titlePropertyId: 'p-title',
      state: createTableState(),
      locale: 'en-US',
      cellContext: { people: [{ id: 'u1', name: 'Jack Uait' }], now: new Date('2026-10-09T15:00:00') },
      handlers: { openRow: vi.fn(), ...handlers } as unknown as TableHandlers,
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
});
