import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rowMenuItems } from '../../../../src/tools/database/database-table-menus';
import type { RowMenuContext } from '../../../../src/tools/database/database-table-menus';
import type { DatabaseData } from '../../../../src/tools/database/types';
import { SCHEMA, buildTool, fakeRow, makeDoc, tableData } from './tier3-harness';
import type { Doc } from './tier3-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

const rightClick = (target: Element): MouseEvent => {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

  target.dispatchEvent(event);

  return event;
};

const cellOf = (el: HTMLElement, rowId: string, propertyId: string): HTMLElement => {
  const cell = el.querySelector<HTMLElement>(`[data-row-id="${rowId}"] [data-blok-database-table-cell][data-property-id="${propertyId}"]`);

  if (cell === null) throw new Error('no cell');

  return cell;
};

const menuContext = (onComment?: () => void): RowMenuContext => ({
  i18n: { t: (key: string) => key },
  properties: [],
  onEditIcon: vi.fn(),
  onEditProperty: vi.fn(),
  onOpenIn: vi.fn(),
  onCopyLink: vi.fn(),
  onDuplicate: vi.fn(),
  onDelete: vi.fn(),
  ...(onComment !== undefined ? { onComment } : {}),
});

const titles = (items: ReturnType<typeof rowMenuItems>): unknown[] => items.map((item) => ('title' in item ? item.title : item.type));

describe('DatabaseTool — config.comments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a right-click on a cell opens the host\'s comments for that cell, inside a declared context-menu owner', () => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha' }, 'a0')]);
    const open = vi.fn();
    const { el } = buildTool(doc, { comments: { open } });
    const cell = cellOf(el, 'a', 'notes');
    const event = rightClick(cell);

    expect(open).toHaveBeenCalledWith({ databaseId: 'db', rowId: 'a', propertyId: 'notes' }, cell);
    expect(event.defaultPrevented).toBe(true);
    // Core's block menu stands down inside the owner (ui.ts), so no stopPropagation is needed.
    expect(cell.closest('[data-blok-context-menu-owner]')).not.toBeNull();
  });

  it('declares no context-menu owner without the comments lever, so core keeps the block menu', () => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha' }, 'a0')]);
    const { el } = buildTool(doc);

    expect(cellOf(el, 'a', 'notes').closest('[data-blok-context-menu-owner]')).toBeNull();
  });

  it('works in read-only, where commenters live', () => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha' }, 'a0')]);
    const open = vi.fn();
    const { el } = buildTool(doc, { comments: { open } }, undefined, true);

    rightClick(cellOf(el, 'a', 'title'));

    expect(open).toHaveBeenCalledWith({ databaseId: 'db', rowId: 'a', propertyId: 'title' }, expect.any(HTMLElement));
  });

  it('leaves the right-click alone without the lever, or when permissions deny comment', () => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha' }, 'a0')]);
    const open = vi.fn();
    const plain = buildTool(doc).el;
    const denied = buildTool(doc, { comments: { open }, permissions: { can: (action) => action !== 'comment' } }).el;

    expect(rightClick(cellOf(plain, 'a', 'notes')).defaultPrevented).toBe(false);
    expect(rightClick(cellOf(denied, 'a', 'notes')).defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('the row menu offers Comment right after Open in only when the host gives comments', () => {
    const onComment = vi.fn();

    expect(titles(rowMenuItems(menuContext()))).not.toContain('tools.database.tableComment');
    const items = rowMenuItems(menuContext(onComment));
    const order = titles(items);

    expect(order.indexOf('tools.database.tableComment')).toBe(order.indexOf('tools.database.tableOpenIn') + 1);
    const comment = items.find((item) => 'title' in item && item.title === 'tools.database.tableComment');

    if (comment === undefined || !('onActivate' in comment) || comment.onActivate === undefined) throw new Error('no Comment item');
    comment.onActivate(comment, undefined);
    expect(onComment).toHaveBeenCalledTimes(1);
  });
});

const BOARD_SCHEMA = [
  ...SCHEMA,
  { id: 'status', name: 'Status', type: 'select' as const, position: 'a3', config: { options: [{ id: 'o1', label: 'Todo', color: 'gray' as const, position: 'a0' }] } },
];

const viewData = (type: 'board' | 'gallery' | 'list' | 'table'): DatabaseData =>
  tableData(BOARD_SCHEMA, { type, ...(type === 'board' ? { groupBy: 'status' } : {}) });

const ROW_SELECTOR: Record<'board' | 'gallery' | 'list' | 'table', string> = {
  board: '[data-blok-database-card][data-row-id="a"]',
  gallery: '[data-blok-database-gallery-card][data-row-id="a"]',
  list: '[data-blok-database-list-row][data-row-id="a"]',
  table: '[data-blok-database-table-row][data-row-id="a"]',
};

const rowEl = (el: HTMLElement, type: keyof typeof ROW_SELECTOR): HTMLElement => {
  const found = el.querySelector<HTMLElement>(ROW_SELECTOR[type]);

  if (found === null) throw new Error(`no ${type} row`);

  return found;
};

const menuItem = (name: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-blok-popover-item][data-blok-item-name="${name}"]`);

const badgeIn = (scope: Element): HTMLButtonElement | null => scope.querySelector<HTMLButtonElement>('[data-blok-database-comment-badge]');

const oneRow = (): Doc => makeDoc([fakeRow('a', 'db', { title: 'Alpha', status: 'o1' }, 'a0')]);

describe('DatabaseTool — comments on cards and list rows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('the board card ••• menu offers Comment ⌘⇧M before Move to Trash, and it opens the row\'s comments', () => {
    const open = vi.fn();
    const { el } = buildTool(oneRow(), { comments: { open } }, viewData('board'));
    const card = rowEl(el, 'board');
    const more = card.querySelector<HTMLElement>('[data-blok-database-card-menu]');

    more?.click();
    const comment = menuItem('database-row-comment');

    expect(comment).not.toBeNull();
    expect(comment?.textContent).toContain('tools.database.tableComment');
    expect(comment?.textContent).toContain('M');
    expect(comment?.compareDocumentPosition(menuItem('database-row-delete') as Node) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    comment?.click();
    // The ••• button hides once the menu closes; the composer sits under the card, as in Notion.
    expect(open).toHaveBeenCalledWith({ databaseId: 'db', rowId: 'a' }, card);
  });

  it('the board card ••• menu has no Comment without the lever', () => {
    const { el } = buildTool(oneRow(), {}, viewData('board'));

    rowEl(el, 'board').querySelector<HTMLElement>('[data-blok-database-card-menu]')?.click();

    expect(menuItem('database-row-delete')).not.toBeNull();
    expect(menuItem('database-row-comment')).toBeNull();
  });

  it.each(['board', 'gallery', 'list'] as const)('a right-click on a %s row opens the menu with Comment, instead of the block menu', (type) => {
    const open = vi.fn();
    const { el } = buildTool(oneRow(), { comments: { open } }, viewData(type));
    const row = rowEl(el, type);
    const event = rightClick(row.firstElementChild ?? row);

    expect(event.defaultPrevented).toBe(true);
    expect(menuItem('database-row-delete')).not.toBeNull();
    menuItem('database-row-comment')?.click();
    expect(open).toHaveBeenCalledWith({ databaseId: 'db', rowId: 'a' }, row);
  });

  it.each(['board', 'gallery', 'list'] as const)('read-only: a right-click on a %s row offers Comment without Move to Trash', (type) => {
    const open = vi.fn();
    const { el } = buildTool(oneRow(), { comments: { open } }, viewData(type), true);

    rightClick(rowEl(el, type));

    expect(menuItem('database-row-delete')).toBeNull();
    menuItem('database-row-comment')?.click();
    expect(open).toHaveBeenCalledWith({ databaseId: 'db', rowId: 'a' }, expect.any(HTMLElement));
  });

  it('a right-click inside a list title being edited keeps the native menu, for copy and paste', () => {
    const { el } = buildTool(oneRow(), { comments: { open: vi.fn() } }, viewData('list'));
    const input = document.createElement('input');

    rowEl(el, 'list').appendChild(input);

    expect(rightClick(input).defaultPrevented).toBe(false);
    expect(menuItem('database-row-comment')).toBeNull();
  });

  it.each(['board', 'gallery', 'list'] as const)('a right-click on a %s row offers no Comment without the lever or when comment is denied', (type) => {
    const open = vi.fn();
    const plain = buildTool(oneRow(), {}, viewData(type)).el;
    const denied = buildTool(oneRow(), { comments: { open }, permissions: { can: (action) => action !== 'comment' } }, viewData(type)).el;

    rightClick(rowEl(plain, type));
    expect(menuItem('database-row-comment')).toBeNull();
    document.body.querySelectorAll('[data-blok-popover]').forEach((popover) => popover.remove());
    rightClick(rowEl(denied, type));
    expect(menuItem('database-row-copy-link')).not.toBeNull();
    expect(menuItem('database-row-comment')).toBeNull();
  });

  it.each(['board', 'gallery', 'list', 'table'] as const)('a %s row with comments shows an "Open comments" badge with the count, which opens the thread', (type) => {
    const open = vi.fn();
    const count = vi.fn((target: { rowId: string }) => (target.rowId === 'a' ? 2 : 0));
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha', status: 'o1' }, 'a0'), fakeRow('b', 'db', { title: 'Beta', status: 'o1' }, 'a1')]);
    const { el } = buildTool(doc, { comments: { open, count } }, viewData(type));
    const badge = badgeIn(rowEl(el, type));

    expect(badge?.tagName).toBe('BUTTON');
    expect(badge?.getAttribute('aria-label')).toBe('tools.database.openComments');
    expect(badge?.textContent?.trim()).toBe('2');
    expect(count).toHaveBeenCalledWith({ databaseId: 'db', rowId: 'a' });
    expect(badgeIn(el.querySelector(ROW_SELECTOR[type].replace('"a"', '"b"')) as Element)).toBeNull();

    badge?.click();
    expect(open).toHaveBeenCalledWith({ databaseId: 'db', rowId: 'a' }, badge);
    // The badge acts on its own: the row page stays shut.
    expect(document.querySelector('[data-blok-database-drawer]')).toBeNull();
  });

  it('shows no badge without a count lever, when the count throws, or when comment is denied', () => {
    const open = vi.fn();
    const none = buildTool(oneRow(), { comments: { open } }, viewData('list')).el;
    const throws = buildTool(oneRow(), { comments: { open, count: () => { throw new Error('down'); } } }, viewData('list')).el;
    const denied = buildTool(oneRow(), { comments: { open, count: () => 3 }, permissions: { can: (action) => action !== 'comment' } }, viewData('list')).el;

    expect(badgeIn(none)).toBeNull();
    expect(badgeIn(throws)).toBeNull();
    expect(badgeIn(denied)).toBeNull();
  });

  it('a host change updates the badges in place, so a composer anchored to one stays attached', () => {
    let counts: Record<string, number> = { a: 1, b: 0 };
    let notify = (): void => undefined;
    const stop = vi.fn();
    const subscribe = vi.fn((_databaseId: string, onChange: () => void) => {
      notify = onChange;

      return stop;
    });
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha', status: 'o1' }, 'a0'), fakeRow('b', 'db', { title: 'Beta', status: 'o1' }, 'a1')]);
    const { tool, el } = buildTool(doc, { comments: { open: vi.fn(), count: ({ rowId }) => counts[rowId] ?? 0, subscribe } }, viewData('list'));
    const rowB = (): Element => el.querySelector('[data-blok-database-list-row][data-row-id="b"]') as Element;
    const badgeA = badgeIn(rowEl(el, 'list'));

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledWith('db', expect.any(Function));
    counts = { a: 2, b: 1 };
    notify();

    expect(badgeIn(rowEl(el, 'list'))).toBe(badgeA);
    expect(badgeA?.isConnected).toBe(true);
    expect(badgeA?.textContent?.trim()).toBe('2');
    expect(badgeIn(rowB())?.textContent?.trim()).toBe('1');

    counts = { a: 0, b: 1 };
    notify();
    expect(badgeIn(rowEl(el, 'list'))).toBeNull();

    tool.destroy();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('a refresh leaves badges of another database alone, as a dashboard shows them', () => {
    let notify = (): void => undefined;
    const { el } = buildTool(oneRow(), { comments: { open: vi.fn(), count: () => 4, subscribe: (_id, onChange) => { notify = onChange; } } }, viewData('list'));
    const foreign = document.createElement('div');

    // A widget row of database "other", drawn by that database's own tool.
    foreign.setAttribute('data-blok-database-comment-anchor', 'x');
    foreign.setAttribute('data-blok-database-comment-database', 'other');
    el.appendChild(foreign);
    notify();

    expect(foreign.nextElementSibling).toBeNull();
    expect(badgeIn(rowEl(el, 'list'))?.textContent?.trim()).toBe('4');
  });

  it('a host subscribe that throws does not break the block', () => {
    const subscribe = vi.fn(() => {
      throw new Error('down');
    });
    const { tool, el } = buildTool(oneRow(), { comments: { open: vi.fn(), count: () => 1, subscribe } }, viewData('list'));

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(badgeIn(rowEl(el, 'list'))).not.toBeNull();
    expect(() => tool.destroy()).not.toThrow();
  });
});
