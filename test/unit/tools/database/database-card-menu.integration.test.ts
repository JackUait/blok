import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseData } from '../../../../src/tools/database/types';
import { SCHEMA, buildTool as buildHarnessTool, fakeRow, makeDoc, tableData } from './tier3-harness';
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

type ViewType = 'board' | 'gallery' | 'list' | 'table' | 'feed';

const built: Array<{ destroy: () => void }> = [];

/** A picked row's key listener sits on the document; a tool left alive would take the next test's keys. */
const buildTool = (...args: Parameters<typeof buildHarnessTool>): ReturnType<typeof buildHarnessTool> => {
  const result = buildHarnessTool(...args);

  built.push(result.tool);

  return result;
};

const BOARD_SCHEMA = [
  ...SCHEMA,
  { id: 'status', name: 'Status', type: 'select' as const, position: 'a3', config: { options: [{ id: 'o1', label: 'Todo', color: 'gray' as const, position: 'a0' }] } },
];

const viewData = (type: ViewType): DatabaseData =>
  tableData(BOARD_SCHEMA, { type, ...(type === 'board' ? { groupBy: 'status' } : {}) });

const oneRow = (): Doc => makeDoc([fakeRow('a', 'db', { title: 'Alpha beta', status: 'o1' }, 'a0')]);

const ROW_SELECTOR: Record<'board' | 'gallery' | 'list', string> = {
  board: '[data-blok-database-card][data-row-id="a"]',
  gallery: '[data-blok-database-gallery-card][data-row-id="a"]',
  list: '[data-blok-database-list-row][data-row-id="a"]',
};

const rowEl = (el: HTMLElement, type: keyof typeof ROW_SELECTOR): HTMLElement => {
  const found = el.querySelector<HTMLElement>(ROW_SELECTOR[type]);

  if (found === null) throw new Error(`no ${type} row`);

  return found;
};

const rightClick = (target: Element): MouseEvent => {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

  target.dispatchEvent(event);

  return event;
};

/** Opens the row's menu the way each view does: •••, right-click, More actions or ⋮⋮. */
const openMenu = (el: HTMLElement, type: ViewType): void => {
  if (type === 'board') {
    rowEl(el, 'board').querySelector<HTMLElement>('[data-blok-database-card-menu]')?.click();
  } else if (type === 'gallery' || type === 'list') {
    rightClick(rowEl(el, type));
  } else if (type === 'feed') {
    el.querySelector<HTMLElement>('[data-blok-database-feed-more-actions]')?.click();
  } else {
    el.querySelector<HTMLElement>('[data-row-id="a"] [data-blok-database-table-row-handle]')?.click();
  }
};

/** The open menu, top to bottom: titles, "|" for a line, and the heading and footer marks. */
const menuOutline = (): string[] => {
  const menu = document.querySelector('[data-blok-popover-opened]');

  if (menu === null) throw new Error('no open menu');

  return Array.from(menu.querySelectorAll('[data-blok-testid="popover-item-title"], [data-blok-testid="popover-item-separator"], [data-blok-database-row-menu-heading], [data-blok-database-row-menu-footer]'))
    .map((node) => {
      if (node.hasAttribute('data-blok-database-row-menu-heading')) return `heading:${node.textContent ?? ''}`;
      if (node.hasAttribute('data-blok-database-row-menu-footer')) return 'footer';
      if (node.getAttribute('data-blok-testid') === 'popover-item-separator') return '|';

      return node.textContent ?? '';
    });
};

const itemByTitle = (title: string): HTMLElement => {
  const titleEl = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-popover-opened] [data-blok-testid="popover-item-title"]')).find((node) => node.textContent === title);
  const item = titleEl?.closest<HTMLElement>('[data-blok-popover-item]');

  if (item === null || item === undefined) throw new Error(`no ${title} item`);

  return item;
};

const menuItem = (name: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-blok-popover-item][data-blok-item-name="${name}"]`);

// research/08 shots-08/65-row-handle-menu.png: search, "Page", then three groups and the footer.
const PAGE = [
  'heading:tools.database.rowMenuPage',
  'tools.database.tableEditIcon',
  'tools.database.tableEditProperty',
];
const REST = [
  '|',
  'tools.database.tableOpenIn',
  'tools.database.tableComment',
  '|',
  'tools.database.tableCopyLink',
  'tools.database.tableDuplicate',
  'tools.database.tableMoveToTrash',
  '|',
  'footer',
];
// research/12 §3: board and gallery add Layout and Property visibility after Edit property.
const WITH_VIEW_SETTINGS = [...PAGE, 'tools.database.settingsLayout', 'tools.database.settingsPropertyVisibility', ...REST];
const WITHOUT_VIEW_SETTINGS = [...PAGE, ...REST];

describe('DatabaseTool — one row menu on every view (research/12 §3, research/08, research/19 §2e)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    built.splice(0).forEach((tool) => tool.destroy());
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it.each([
    ['board', WITH_VIEW_SETTINGS],
    ['gallery', WITH_VIEW_SETTINGS],
    ['list', WITHOUT_VIEW_SETTINGS],
    ['feed', WITHOUT_VIEW_SETTINGS],
    ['table', WITHOUT_VIEW_SETTINGS],
  ] as const)('the %s menu has the measured items in the measured order', (type, expected) => {
    const { el } = buildTool(oneRow(), { comments: { open: vi.fn() } }, viewData(type));

    openMenu(el, type);

    expect(menuOutline()).toEqual(expected);
    expect(document.querySelector('[data-blok-popover-opened] input[placeholder="tools.database.searchActions"]')).not.toBeNull();
  });

  it.each(['board', 'gallery', 'list'] as const)('a right-click on a %s row opens the menu without a comments lever', (type) => {
    const { el } = buildTool(oneRow(), {}, viewData(type));

    expect(rightClick(rowEl(el, type)).defaultPrevented).toBe(true);
    expect(menuItem('database-row-copy-link')).not.toBeNull();
    expect(menuOutline()).not.toContain('tools.database.tableComment');
  });

  it.each(['board', 'gallery', 'list'] as const)('read-only: a right-click on a %s row offers only what does not edit the row', (type) => {
    const { el } = buildTool(oneRow(), { comments: { open: vi.fn() } }, viewData(type), true);

    rightClick(rowEl(el, type));

    expect(menuOutline()).toEqual([
      'heading:tools.database.rowMenuPage',
      'tools.database.tableOpenIn',
      'tools.database.tableComment',
      '|',
      'tools.database.tableCopyLink',
      '|',
      'footer',
    ]);
  });

  it('the footer counts the words and characters of the card title', () => {
    const { el } = buildTool(oneRow(), {}, viewData('board'));

    openMenu(el, 'board');

    expect(document.querySelector('[data-blok-database-row-menu-footer]')?.textContent).toContain('tools.database.rowWordCount');
  });

  it.each(['board', 'gallery', 'list', 'feed'] as const)('the %s menu footer names who edited the row last, as the table menu does', async (type) => {
    const edited = (): Doc => {
      const doc = oneRow();
      const row = doc.rows.get('a');

      if (row === undefined) throw new Error('no row');
      Object.assign(row.block, { lastEditedBy: 'u1', lastEditedAt: Date.now() - 60_000 });

      return doc;
    };
    const people = { list: () => Promise.resolve([{ id: 'u1', name: 'Jack Uait' }]) };
    const footerOf = async (view: ViewType): Promise<string> => {
      const { el, tool } = buildTool(edited(), { people }, viewData(view));

      // The people lever loads once, then the view redraws with the names.
      await vi.waitFor(() => {
        openMenu(el, view);
        expect(document.querySelector('[data-blok-database-row-menu-footer]')?.textContent).toContain('tools.database.rowLastEditedBy');
      });
      const text = document.querySelector('[data-blok-database-row-menu-footer]')?.textContent ?? '';

      document.querySelectorAll('[data-blok-popover]').forEach((popover) => popover.remove());
      tool.destroy();

      return text;
    };

    expect(await footerOf(type)).toBe(await footerOf('table'));
  });

  it('Edit property › lists the card\'s properties, and one opens that value\'s editor on the row page', () => {
    const { el } = buildTool(oneRow(), {}, viewData('board'));

    openMenu(el, 'board');
    itemByTitle('tools.database.tableEditProperty').click();
    const notes = menuItem('database-row-edit-property-notes');

    expect(menuItem('database-row-edit-property-title')).toBeNull();
    expect(notes).not.toBeNull();
    notes?.click();

    expect(document.querySelector('[data-blok-database-cell-editor] textarea, [data-blok-database-cell-editor] input')).not.toBeNull();
  });

  it.each([
    ['tools.database.settingsLayout'],
    ['tools.database.settingsPropertyVisibility'],
  ])('%s opens that page of the view settings', (title) => {
    const { el } = buildTool(oneRow(), {}, viewData('board'));

    openMenu(el, 'board');
    itemByTitle(title).click();

    expect(document.querySelector('[data-blok-testid="database-view-settings"] [data-blok-database-panel-header]')?.textContent).toContain(title);
  });

  it('Move to Trash on a card removes the row', () => {
    const doc = oneRow();
    const { el } = buildTool(doc, {}, viewData('board'));

    openMenu(el, 'board');
    menuItem('database-row-delete')?.click();

    expect(doc.api.blocks.delete).toHaveBeenCalledWith(0);
  });

  describe('Comment ⌘⇧M and Move to ⌘⇧P on one picked row', () => {
    const press = (target: EventTarget, key: string): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { key, metaKey: true, shiftKey: true, bubbles: true, cancelable: true });

      target.dispatchEvent(event);

      return event;
    };
    const withOtherDatabase = (doc: Doc): Doc => {
      vi.mocked(doc.api.blocks.getBlockByIndex).mockReturnValue({ id: 'db2', name: 'database', preservedData: { title: 'Projects' } } as never);

      return doc;
    };

    it.each(['board', 'list'] as const)('a picked %s row opens its comments on ⌘⇧M', (type) => {
      const open = vi.fn();
      const { el } = buildTool(oneRow(), { comments: { open } }, viewData(type));
      const row = rowEl(el, type);

      row.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
      const event = press(document.body, 'M');

      expect(open).toHaveBeenCalledWith({ databaseId: 'db', rowId: 'a' }, row);
      expect(event.defaultPrevented).toBe(true);
    });

    it('a picked board card lists the other databases on ⌘⇧P', () => {
      const { el } = buildTool(withOtherDatabase(oneRow()), {}, viewData('board'));

      rowEl(el, 'board').dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
      press(document.body, 'p');

      expect(menuItem('database-row-move-to-db2')).not.toBeNull();
    });

    it('a selected table row opens its comments on ⌘⇧M and lists the other databases on ⌘⇧P', () => {
      const open = vi.fn();
      const { el } = buildTool(withOtherDatabase(oneRow()), { comments: { open } }, viewData('table'));

      openMenu(el, 'table');
      document.querySelectorAll('[data-blok-popover]').forEach((popover) => popover.remove());
      const grid = el.querySelector<HTMLElement>('[role="grid"]');

      if (grid === null) throw new Error('no grid');
      press(grid, 'm');
      expect(open).toHaveBeenCalledWith({ databaseId: 'db', rowId: 'a' }, expect.any(HTMLElement));
      press(grid, 'p');
      expect(menuItem('database-row-move-to-db2')).not.toBeNull();
    });

    it('two picked rows take no ⌘⇧M: the comment is for one page', () => {
      const open = vi.fn();
      const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha', status: 'o1' }, 'a0'), fakeRow('b', 'db', { title: 'Beta', status: 'o1' }, 'a1')]);
      const { el } = buildTool(doc, { comments: { open } }, viewData('board'));

      el.querySelector('[data-blok-database-card][data-row-id="a"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
      el.querySelector('[data-blok-database-card][data-row-id="b"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
      press(document.body, 'm');

      expect(open).not.toHaveBeenCalled();
    });
  });
});
