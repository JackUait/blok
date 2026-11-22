import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseData } from '../../../../src/tools/database/types';
import { SCHEMA, buildTool as buildHarnessTool, fakeRow, makeDoc, tableData } from './tier3-harness';
import type { Doc } from './tier3-harness';
import { hover, shownHint } from './hint-harness';
import { HINT_DELAY, destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { PopoverAbstract } from '../../../../src/components/utils/popover/popover-abstract';

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

const ROW_SELECTOR: Record<'board' | 'gallery' | 'list' | 'table', string> = {
  board: '[data-blok-database-card][data-row-id="a"]',
  table: '[data-blok-database-table-row][data-row-id="a"]',
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
  if (type === 'board' || type === 'gallery') {
    rowEl(el, type).querySelector<HTMLElement>('[data-blok-database-card-menu]')?.click();
  } else if (type === 'list') {
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
// research/12 §3: board and gallery add Layout and Property visibility after Edit property,
// set apart by a line (feel findings B15, 09-notion-card-menu.png).
const WITH_VIEW_SETTINGS = [...PAGE, '|', 'tools.database.settingsLayout', 'tools.database.settingsPropertyVisibility', ...REST];
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

  it('the board menu footer writes an edit from today with the "Today at" phrase (research/35 §19)', () => {
    const doc = oneRow();
    const block = doc.rows.get('a')?.block as unknown as { lastEditedAt?: number };

    block.lastEditedAt = Date.now();
    const { el } = buildTool(doc, {}, viewData('board'));

    openMenu(el, 'board');

    expect(document.querySelector('[data-blok-database-row-menu-footer]')?.textContent).toContain('tools.database.rowEditedTodayAt');
  });

  // research/23 §157 (Notion): a table row's right-click opens the same menu as its ⋮⋮.
  it('a right-click on a table row opens its ⋮⋮ menu at the pointer, not the comments', () => {
    const open = vi.fn();
    const { el } = buildTool(oneRow(), { comments: { open } }, viewData('table'));
    const cell = rowEl(el, 'table').querySelector<HTMLElement>('[data-blok-database-table-cell]');

    if (cell === null) throw new Error('no cell');
    const event = rightClick(cell);

    expect(menuOutline()).toEqual(WITHOUT_VIEW_SETTINGS);
    expect(open).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    menuItem('database-row-comment')?.click();
    expect(open).toHaveBeenCalledWith({ databaseId: 'db', rowId: 'a' }, rowEl(el, 'table'));
  });

  it('drops a table row\'s pointer anchor when its right-click menu closes', () => {
    const { el } = buildTool(oneRow(), {}, viewData('table'));

    rowEl(el, 'table').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 120 }));
    const point = document.querySelector<HTMLElement>('[data-blok-database-menu-point]');

    expect(point?.style.left).toBe('300px');
    expect(point?.style.top).toBe('121px');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    menuItem('database-row-copy-link')?.click();
    expect(document.querySelector('[data-blok-database-menu-point]')).toBeNull();
  });

  it('a read-only table row\'s right-click menu keeps Comment and Copy link, with no edits', () => {
    const open = vi.fn();
    const { el } = buildTool(oneRow(), { comments: { open } }, viewData('table'), true);

    expect(rightClick(rowEl(el, 'table')).defaultPrevented).toBe(true);
    expect(menuItem('database-row-duplicate')).toBeNull();
    expect(menuItem('database-row-delete')).toBeNull();
    expect(menuItem('database-row-copy-link')).not.toBeNull();
    menuItem('database-row-comment')?.click();
    expect(open).toHaveBeenCalledWith({ databaseId: 'db', rowId: 'a' }, expect.any(HTMLElement));
  });

  it('a right-click in a table cell being edited keeps the native menu', () => {
    const { el } = buildTool(oneRow(), {}, viewData('table'));
    const input = document.createElement('input');

    rowEl(el, 'table').querySelector('[data-blok-database-table-cell]')?.appendChild(input);

    expect(rightClick(input).defaultPrevented).toBe(false);
    expect(document.querySelector('[data-blok-popover-opened]')).toBeNull();
  });

  it.each(['board', 'gallery', 'list', 'table'] as const)('a right-click on a %s row opens the menu without a comments lever', (type) => {
    const { el } = buildTool(oneRow(), {}, viewData(type));

    expect(rightClick(rowEl(el, type)).defaultPrevented).toBe(true);
    expect(menuItem('database-row-copy-link')).not.toBeNull();
    expect(menuOutline()).not.toContain('tools.database.tableComment');
  });

  // findings-listgallery L16: Notion opens a list row's right-click menu at the pointer.
  it('anchors a list row\'s right-click menu at the pointer, and drops the anchor when the menu closes', () => {
    const { el } = buildTool(oneRow(), {}, viewData('list'));

    rowEl(el, 'list').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 120 }));
    const point = document.querySelector<HTMLElement>('[data-blok-database-menu-point]');

    expect(point?.hasAttribute('data-popover-open')).toBe(true);
    expect(point?.style.left).toBe('300px');
    // notion-motion.md Round 58 §6: below the pointer, the menu's top is y + 1.
    expect(point?.style.top).toBe('121px');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    menuItem('database-row-copy-link')?.click();

    expect(document.querySelector('[data-blok-database-menu-point]')).toBeNull();
  });

  // notion-motion.md Round 23 §3: the card is picked while its ⋯ menu is open, stays picked after Escape, and a click outside clears it.
  it('picks the board card while its ⋯ menu is open and after Escape, until the next press', () => {
    const { el } = buildTool(oneRow(), {}, viewData('board'));

    openMenu(el, 'board');
    expect(rowEl(el, 'board').hasAttribute('data-blok-database-card-picked')).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(rowEl(el, 'board').hasAttribute('data-popover-open')).toBe(false);
    expect(rowEl(el, 'board').hasAttribute('data-blok-database-card-picked')).toBe(true);

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(rowEl(el, 'board').hasAttribute('data-blok-database-card-picked')).toBe(false);
  });

  it('drops the card pick when the tool is destroyed', () => {
    const { el, tool } = buildTool(oneRow(), {}, viewData('board'));

    openMenu(el, 'board');
    const card = rowEl(el, 'board');

    tool.destroy();
    expect(card.hasAttribute('data-blok-database-card-picked')).toBe(false);
  });

  // notion-motion.md Round 108 §1 #6: a middle click away keeps the card right-click menu open.
  it('keeps a board card\'s right-click menu open on a middle click away', () => {
    const { el } = buildTool(oneRow(), {}, viewData('board'));
    const away = document.createElement('div');

    document.body.appendChild(away);
    rowEl(el, 'board').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 120 }));
    away.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 1 }));

    expect(document.querySelector('[data-blok-popover-opened]')).not.toBeNull();
    away.remove();
  });

  // notion-motion.md Round 109 §1 #1: Duplicate on a card's ••• menu makes the copy and removes the menu.
  // The table's ⋮⋮ menu closed only because the table redraw destroys it; the board keeps its card menu.
  it('Duplicate on a board card\'s ••• menu closes the menu with a fade', () => {
    const doc = oneRow();
    const { el } = buildTool(doc, {}, viewData('board'));
    const fades: boolean[] = [];
    const hide = PopoverAbstract.prototype.hide;

    vi.spyOn(PopoverAbstract.prototype, 'hide').mockImplementation(function (this: PopoverAbstract) {
      fades.push(this.itemCloseFades);
      hide.call(this);
    });
    openMenu(el, 'board');
    menuItem('database-row-duplicate')?.click();

    expect(document.querySelector('[data-blok-popover-opened]')).toBeNull();
    expect(doc.api.blocks.insertAt).toHaveBeenCalled();
    expect(fades[0]).toBe(true);
  });

  it('Duplicate on a board card\'s ••• menu leaves focus on that card\'s •••', () => {
    const { el } = buildTool(oneRow(), {}, viewData('board'));

    openMenu(el, 'board');
    menuItem('database-row-duplicate')?.click();

    expect(el.querySelector('[data-blok-database-card][data-row-id="a"] [data-blok-database-card-menu]')).toHaveFocus();
  });

  it('Duplicate on a board card\'s right-click menu closes it at once', () => {
    const { el } = buildTool(oneRow(), {}, viewData('board'));
    const fades: boolean[] = [];
    const hide = PopoverAbstract.prototype.hide;

    vi.spyOn(PopoverAbstract.prototype, 'hide').mockImplementation(function (this: PopoverAbstract) {
      fades.push(this.itemCloseFades);
      hide.call(this);
    });
    rowEl(el, 'board').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 120 }));
    menuItem('database-row-duplicate')?.click();

    expect(document.querySelector('[data-blok-popover-opened]')).toBeNull();
    expect(fades[0]).toBe(false);
  });

  // notion-motion.md Round 109 §1 #2: a middle click away keeps a card's ••• menu open too.
  it('keeps a board card\'s ••• menu open on a middle click away', () => {
    const { el } = buildTool(oneRow(), {}, viewData('board'));
    const away = document.createElement('div');

    document.body.appendChild(away);
    openMenu(el, 'board');
    away.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 1 }));

    expect(document.querySelector('[data-blok-popover-opened]')).not.toBeNull();
    away.remove();
  });

  // notion-motion.md Round 109 §1 #3: a middle click on a cell keeps the table ⋮⋮ menu open, and the cell takes no focus.
  it('keeps a table row\'s ⋮⋮ menu open on a middle click on a cell', () => {
    const { el } = buildTool(oneRow(), {}, viewData('table'));

    openMenu(el, 'table');
    const cell = el.querySelector<HTMLElement>('[data-row-id="a"] [data-blok-database-table-cell]');

    if (cell === null) throw new Error('no cell');
    cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 1 }));
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1 }));

    expect(document.querySelector('[data-blok-popover-opened]')).not.toBeNull();
    expect(cell.contains(document.activeElement)).toBe(false);
  });

  // notion-motion.md Round 58 §6: a board card's menu opens at the pointer x, not the card's left.
  it('anchors a board card\'s right-click menu at the pointer', () => {
    const { el } = buildTool(oneRow(), {}, viewData('board'));

    rowEl(el, 'board').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 120 }));
    const point = document.querySelector<HTMLElement>('[data-blok-database-menu-point]');

    expect(point?.style.left).toBe('300px');
    expect(point?.style.top).toBe('121px');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    menuItem('database-row-copy-link')?.click();
    expect(document.querySelector('[data-blok-database-menu-point]')).toBeNull();
  });

  // notion-motion.md Round 58 §6 (list menu 458.9 tall, window 717): below at y + 1 when it fits,
  // above with its bottom on y when its top keeps 12 (y 471 → 12.1, y 470 → 11.1 no), else clamped 12 over the bottom.
  it.each([
    ['list', 185, 186],
    ['list', 471, 12],
    ['list', 470, 246],
    ['board', 185, 186],
    ['board', 551, 92],
    ['board', 349, 246],
    // Round 59 §4: gallery cards and table rows follow the same rule.
    ['gallery', 190, 191],
    ['gallery', 471, 12],
    ['gallery', 470, 246],
    ['table', 185, 186],
    ['table', 472, 13],
    ['table', 469, 246],
  ] as const)('opens a %s right-click menu for a pointer at y %i with its top at %i', (type, y, top) => {
    const { el } = buildTool(oneRow(), {}, viewData(type));
    const real = Element.prototype.getBoundingClientRect;

    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(717);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(459);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this instanceof HTMLElement && this.hasAttribute('data-blok-database-menu-point') ? new DOMRect(700, Number.parseFloat(this.style.top), 0, 0) : real.call(this);
    });
    rowEl(el, type).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 700, clientY: y }));
    const menu = document.querySelector<HTMLElement>('.blok-database-card-menu');

    expect(menu?.style.top).toBe(`${top}px`);
  });

  // notion-motion.md Round 13: a right-click opens the one-card menu and drops every pick.
  it.each([{ picked: ['a', 'b'] }, { picked: ['a'] }])('a right-click on board card b with $picked picked opens b\'s own menu and drops the picks', ({ picked }) => {
    const doc = makeDoc([fakeRow('a', 'db', { title: 'Alpha', status: 'o1' }, 'a0'), fakeRow('b', 'db', { title: 'Beta', status: 'o1' }, 'a1')]);
    const { el } = buildTool(doc, { comments: { open: vi.fn() } }, viewData('board'));
    const card = (id: string): HTMLElement => {
      const found = el.querySelector<HTMLElement>(`[data-blok-database-card][data-row-id="${id}"]`);

      if (found === null) throw new Error(`no card ${id}`);

      return found;
    };

    picked.forEach((id) => card(id).dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })));
    expect(el.querySelectorAll('[data-blok-database-row-selected]')).toHaveLength(picked.length);

    const event = rightClick(card('b'));

    expect(el.querySelectorAll('[data-blok-database-row-selected]')).toHaveLength(0);
    expect(document.querySelector('[data-blok-database-table-selection-bar]')).toBeNull();
    expect(menuOutline()).toEqual(WITH_VIEW_SETTINGS);
    expect(event.defaultPrevented).toBe(true);
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

  describe('dates follow the editor\'s locale, not the browser\'s', () => {
    /** ru at 16:54 reads "16:54"; the browser's en-US would read "4:54 PM". */
    const ruEditor = (doc: Doc): void => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
      Object.assign(doc.api.i18n, {
        t: (key: string, vars?: Record<string, string | number>) => `${key}|${Object.values(vars ?? {}).join('|')}`,
        getLocale: () => 'ru',
      });
    };

    afterEach(() => {
      vi.useRealTimers();
    });

    it.each(['board', 'list', 'feed', 'table'] as const)('the %s menu footer writes "Today at" with the editor\'s clock', (type) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 9, 22, 16, 54));
      const doc = oneRow();
      const block = doc.rows.get('a')?.block as unknown as { lastEditedAt?: number; createdBy?: string; createdAt?: number };

      block.lastEditedAt = Date.now();
      block.createdBy = 'u1';
      ruEditor(doc);
      const { el } = buildTool(doc, {}, viewData(type));

      openMenu(el, type);

      expect(document.querySelector('[data-blok-database-row-menu-footer]')?.textContent).toContain('tools.database.rowEditedTodayAt|16:54');
    });

    it.each(['board', 'table'] as const)('the %s menu keeps an en-GB browser\'s 24 hour clock under an en editor', (type) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 9, 22, 16, 54));
      const doc = oneRow();
      const block = doc.rows.get('a')?.block as unknown as { lastEditedAt?: number };

      block.lastEditedAt = Date.now();
      ruEditor(doc);
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB');
      Object.assign(doc.api.i18n, { getLocale: () => 'en' });
      const { el } = buildTool(doc, {}, viewData(type));

      openMenu(el, type);

      expect(document.querySelector('[data-blok-database-row-menu-footer]')?.textContent).toContain('tools.database.rowEditedTodayAt|16:54');
    });

    it('the feed\'s "Created … at …" hint writes the date and time in the editor\'s locale', () => {
      destroyTooltip();
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 9, 22, 17, 30));
      const at = new Date(2026, 9, 22, 16, 54, 7);
      const doc = oneRow();
      const block = doc.rows.get('a')?.block as unknown as { createdBy?: string; createdAt?: number };

      block.createdBy = 'u1';
      block.createdAt = at.getTime();
      ruEditor(doc);
      const { el } = buildTool(doc, {}, viewData('feed'));

      hover(el.querySelector('[data-blok-database-feed-time]'));
      vi.advanceTimersByTime(HINT_DELAY);

      expect(shownHint()?.text).toBe('tools.database.feedCreatedAt|22 октября 2026 г.|16:54:07');
    });
  });

  it('the footer counts the words and characters of the card title', () => {
    const { el } = buildTool(oneRow(), {}, viewData('board'));

    openMenu(el, 'board');

    expect(document.querySelector('[data-blok-database-row-menu-footer-counts]')?.textContent).toBe('tools.database.rowCounts');
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
        expect(document.querySelector('[data-blok-database-row-menu-footer-person]')?.textContent).toBe('Jack Uait');
      });
      const text = document.querySelector('[data-blok-database-row-menu-footer]')?.textContent ?? '';

      document.querySelectorAll('[data-blok-popover]').forEach((popover) => popover.remove());
      tool.destroy();

      return text;
    };

    expect(await footerOf(type)).toBe(await footerOf('table'));
  });

  it('a click on the list row\'s drag handle opens the list row menu, not the page (research/12 §3, 66-list-handle-click.png)', () => {
    const { el, tool } = buildTool(oneRow(), { comments: { open: vi.fn() } }, viewData('list'));
    const openPage = vi.spyOn(tool as unknown as { handleRowClick: (rowId: string) => void }, 'handleRowClick');
    const handle = rowEl(el, 'list').querySelector<HTMLElement>('[data-blok-database-list-row-handle]');

    if (handle === null) throw new Error('no list row handle');
    handle.click();

    expect(menuOutline()).toEqual(WITHOUT_VIEW_SETTINGS);
    // notion-motion.md Round 10: it opens beside the handle, not over it.
    expect(document.querySelector('[data-blok-popover-custom-class~="blok-database-handle-menu"]')).not.toBeNull();
    expect(rowEl(el, 'list').hasAttribute('data-popover-open')).toBe(true);
    expect(openPage).not.toHaveBeenCalled();
    // A click on the row itself does open the page, so the check above can fail.
    rowEl(el, 'list').querySelector<HTMLElement>('[data-blok-database-list-row-title]')?.click();
    expect(openPage).toHaveBeenCalledWith('a');
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

  // notion-motion.md Round 68 §4: from a right-click, Select and Number open alone at the click point in Board and
  // Table, x = click x - 1, not on the row page or over the column's cell. Table Date too.
  describe('Edit property › from a right-click', () => {
    const POINT_SCHEMA = [
      ...BOARD_SCHEMA,
      { id: 'cost', name: 'Cost', type: 'number' as const, position: 'a4' },
      { id: 'due', name: 'Due', type: 'date' as const, position: 'a5' },
      { id: 'done', name: 'Done', type: 'checkbox' as const, position: 'a6' },
      { id: 'site', name: 'Site', type: 'url' as const, position: 'a7' },
    ];
    const pointRow = (): Doc => makeDoc([fakeRow('a', 'db', { title: 'Alpha beta', status: 'o1', cost: 1234.5, due: '2026-10-15', notes: 'Short note', done: true }, 'a0')]);

    const editFromRightClick = (el: HTMLElement, type: 'board' | 'table', propertyId: string): void => {
      rowEl(el, type).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 700, clientY: 424 }));
      itemByTitle('tools.database.tableEditProperty').click();
      menuItem(`database-row-edit-property-${propertyId}`)?.click();
    };

    it.each([
      ['board', 'status', '[data-blok-database-cell-editor] input'],
      ['board', 'cost', '[data-blok-database-cell-editor] input'],
      ['table', 'status', '[data-blok-database-cell-editor] input'],
      ['table', 'cost', '[data-blok-database-cell-editor] input'],
      ['table', 'due', '[data-blok-database-date-editor]'],
      // Round 69 §2: Board Text and Date, and Table Text, open at the point too.
      ['board', 'notes', '[data-blok-database-cell-editor] textarea'],
      ['board', 'due', '[data-blok-database-date-editor]'],
      ['table', 'notes', '[data-blok-database-cell-editor] textarea'],
    ] as const)('%s: %s opens at the click point', (type, propertyId, editor) => {
      const { el } = buildTool(pointRow(), {}, tableData(POINT_SCHEMA, { type, ...(type === 'board' ? { groupBy: 'status' } : {}) }));

      editFromRightClick(el, type, propertyId);

      expect(document.querySelector('[data-blok-database-drawer], [data-blok-database-peek]')).toBeNull();
      expect(document.querySelector(editor)).not.toBeNull();
      const point = document.querySelector<HTMLElement>('[data-blok-database-edit-point]');

      expect([point?.style.left, point?.style.top]).toEqual(['699px', '424px']);
      expect(document.querySelector('[data-blok-popover-custom-class~="blok-database-point-editor"]')).not.toBeNull();
    });

    it.each(['board', 'table'] as const)('%s: Escape closes it and takes the point away', (type) => {
      const { el } = buildTool(pointRow(), {}, tableData(POINT_SCHEMA, { type, ...(type === 'board' ? { groupBy: 'status' } : {}) }));

      editFromRightClick(el, type, 'cost');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

      expect(document.querySelector('[data-blok-database-cell-editor]')).toBeNull();
      expect(document.querySelector('[data-blok-database-edit-point]')).toBeNull();
    });

    it('a board URL, not measured yet, still opens on the row page', () => {
      const { el } = buildTool(pointRow(), {}, tableData(POINT_SCHEMA, { type: 'board', groupBy: 'status' }));

      editFromRightClick(el, 'board', 'site');

      expect(document.querySelector('[data-blok-database-edit-point]')).toBeNull();
    });

    // Round 69 §2: a board Checkbox flips with no editor and no row page; the menus close and nothing is picked.
    it('board: Checkbox flips the value and closes the menus', () => {
      const doc = pointRow();
      const { el } = buildTool(doc, {}, tableData(POINT_SCHEMA, { type: 'board', groupBy: 'status' }));

      editFromRightClick(el, 'board', 'done');

      expect(doc.rows.get('a')?.data.properties.done).toBe(false);
      expect(document.querySelector('[data-blok-popover-opened]')).toBeNull();
      expect(document.querySelector('[data-blok-database-drawer], [data-blok-database-peek], [data-blok-database-cell-editor]')).toBeNull();
      expect(el.querySelector('[data-blok-database-card-picked]')).toBeNull();
    });
  });

  // notion-motion.md Round 70 §2: after a right-click on a cell, Notion keeps the row selected and focuses that cell.
  describe('table: focus after a right-click row menu', () => {
    const FOCUS_SCHEMA = [...BOARD_SCHEMA, { id: 'done', name: 'Done', type: 'checkbox' as const, position: 'a4' }];
    const focusRow = (): Doc => makeDoc([fakeRow('a', 'db', { title: 'Alpha beta', status: 'o1', notes: 'Short note', done: true }, 'a0')]);
    const notesCell = (el: HTMLElement): HTMLElement | null => el.querySelector<HTMLElement>('[data-row-id="a"] [role="gridcell"][data-property-id="notes"]');
    const rowSelected = (el: HTMLElement): string | null | undefined => el.querySelector('[data-blok-database-table-row][data-row-id="a"]')?.getAttribute('aria-selected');
    const rightClickNotes = (el: HTMLElement): void => {
      const cell = notesCell(el);

      if (cell === null) throw new Error('no Notes cell');
      cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 700, clientY: 424 }));
    };

    it('Edit property › Checkbox flips the value, keeps the row selected and focuses the right-clicked cell', async () => {
      const doc = focusRow();
      const { el } = buildTool(doc, {}, tableData(FOCUS_SCHEMA, { type: 'table' }));

      rightClickNotes(el);
      itemByTitle('tools.database.tableEditProperty').click();
      menuItem('database-row-edit-property-done')?.click();
      // The flip redraws the table; the new one takes the selection and focus a task later.
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });

      expect(rowSelected(el)).toBe('true');
      expect(notesCell(el)).toHaveFocus();
      expect(doc.rows.get('a')?.data.properties.done).toBe(false);
      expect(document.querySelector('[data-blok-popover-opened]')).toBeNull();
    });

    // notion-motion.md Round 103 §1 #5: Escape removes the right-click row menu at once, as it does the ⋮⋮ menu.
    it('Escape closes the right-click row menu at once, with no fade', () => {
      const { el } = buildTool(focusRow(), {}, tableData(FOCUS_SCHEMA, { type: 'table' }));
      const atOnce: boolean[] = [];
      const hideOnEscape = PopoverAbstract.prototype.hideOnEscape;

      vi.spyOn(PopoverAbstract.prototype, 'hideOnEscape').mockImplementation(function (this: PopoverAbstract) {
        atOnce.push(this.closesAtOnce);
        hideOnEscape.call(this);
      });
      rightClickNotes(el);
      (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

      expect(atOnce).toEqual([true]);
    });

    // notion-motion.md Round 104 §1 #1: a click on an item or away from the menu removes it at once too.
    it('every close of the right-click row menu is instant, an item click included', () => {
      const { el } = buildTool(focusRow(), {}, tableData(FOCUS_SCHEMA, { type: 'table' }));
      const atOnce: boolean[] = [];
      const hide = PopoverAbstract.prototype.hide;

      vi.spyOn(PopoverAbstract.prototype, 'hide').mockImplementation(function (this: PopoverAbstract) {
        atOnce.push(this.closesAtOnce);
        hide.call(this);
      });
      rightClickNotes(el);
      itemByTitle('tools.database.tableDuplicate').click();

      expect(atOnce.length).toBeGreaterThan(0);
      expect(atOnce.every(Boolean)).toBe(true);
      expect(document.querySelector('[data-blok-popover-opened]')).toBeNull();
    });

    it('Escape on the row menu keeps the row selected and focuses the right-clicked cell', async () => {
      const { el } = buildTool(focusRow(), {}, tableData(FOCUS_SCHEMA, { type: 'table' }));

      rightClickNotes(el);
      expect(document.querySelector('[data-blok-popover-opened]')).not.toBeNull();
      (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });

      expect(notesCell(el)).toHaveFocus();
      expect(rowSelected(el)).toBe('true');
      expect(document.querySelector('[data-blok-popover-opened]')).toBeNull();
    });
  });

  // notion-motion.md Round 42 §2: a card that shows only Name still has Edit property ›, and it lists every
  // property, not the shown ones. Created time and ID were not in Notion's list.
  it('Edit property › lists every property on a card that shows only Name', () => {
    const schema = [
      ...BOARD_SCHEMA,
      { id: 'made', name: 'Created time', type: 'createdTime' as const, position: 'a4' },
      { id: 'uid', name: 'ID', type: 'uniqueId' as const, position: 'a5' },
    ];
    const { el } = buildTool(oneRow(), {}, tableData(schema, { type: 'board', groupBy: 'status', visibleProperties: [] }));

    openMenu(el, 'board');
    itemByTitle('tools.database.tableEditProperty').click();

    // Notion's list read A→Z (Checkbox, Date, Email, …, URL), not in column order.
    expect([...document.querySelectorAll('[data-blok-item-name^="database-row-edit-property-"]')].map((item) => item.getAttribute('data-blok-item-name')))
      .toEqual(['notes', 'status', 'where'].map((id) => `database-row-edit-property-${id}`));
    expect(menuItem('database-row-edit-property-made')).toBeNull();
    expect(menuItem('database-row-edit-property-uid')).toBeNull();
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

    expect(doc.api.blocks.delete).toHaveBeenCalledWith(0, false);
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

    /** The Move to picker's rows, once its first search has answered. */
    const moveOptions = async (): Promise<string[]> => {
      await new Promise((resolve) => setTimeout(resolve, 0));

      return [...document.querySelectorAll('[data-blok-database-move-picker] [role="option"]')].map((option) => option.textContent ?? '');
    };

    afterEach(() => {
      document.querySelectorAll('[data-blok-database-move-picker]').forEach((picker) => picker.remove());
    });

    it('a picked board card lists the other databases on ⌘⇧P', async () => {
      const { el } = buildTool(withOtherDatabase(oneRow()), {}, viewData('board'));

      rowEl(el, 'board').dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
      press(document.body, 'p');

      expect(await moveOptions()).toEqual(['Projects']);
    });

    it('a selected table row opens its comments on ⌘⇧M and lists the other databases on ⌘⇧P', async () => {
      const open = vi.fn();
      const { el } = buildTool(withOtherDatabase(oneRow()), { comments: { open } }, viewData('table'));

      openMenu(el, 'table');
      document.querySelectorAll('[data-blok-popover]').forEach((popover) => popover.remove());
      const grid = el.querySelector<HTMLElement>('[role="grid"]');

      if (grid === null) throw new Error('no grid');
      press(grid, 'm');
      expect(open).toHaveBeenCalledWith({ databaseId: 'db', rowId: 'a' }, expect.any(HTMLElement));
      press(grid, 'p');
      expect(await moveOptions()).toEqual(['Projects']);
    });

    // notion-motion.md Round 65 §3: Escape after ⌘⇧P drops the row selection.
    it('drops the table row selection when Escape closes the ⌘⇧P picker', async () => {
      const { el } = buildTool(withOtherDatabase(oneRow()), {}, viewData('table'));

      openMenu(el, 'table');
      document.querySelectorAll('[data-blok-popover]').forEach((popover) => popover.remove());
      const grid = el.querySelector<HTMLElement>('[role="grid"]');
      const row = (): Element | null => el.querySelector('[data-blok-database-table-row][data-row-id="a"]');

      if (grid === null) throw new Error('no grid');
      press(grid, 'p');
      expect(await moveOptions()).toEqual(['Projects']);
      expect(row()?.getAttribute('aria-selected')).toBe('true');
      document.querySelector('[data-blok-database-move-picker] input')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

      expect(row()?.getAttribute('aria-selected')).toBe('false');
    });

    // notion-motion.md Round 66 §4: from a right-click, Escape drops the row selection and leaves the Name cell selected.
    it('leaves the Name cell selected when Escape closes the right-click Move to picker', async () => {
      const { el } = buildTool(withOtherDatabase(oneRow()), {}, viewData('table'));
      const row = (): Element | null => el.querySelector('[data-blok-database-table-row][data-row-id="a"]');
      const selectedCells = (): Array<string | null> => [...el.querySelectorAll('[data-row-id="a"] [role="gridcell"][aria-selected="true"]')]
        .map((cell) => cell.getAttribute('data-property-id'));

      rowEl(el, 'table').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 120 }));
      itemByTitle('tools.database.tableMoveTo').click();
      expect(await moveOptions()).toEqual(['Projects']);
      expect(row()?.getAttribute('aria-selected')).toBe('true');
      document.querySelector('[data-blok-database-move-picker] input')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

      expect(selectedCells()).toEqual(['title']);
      expect(row()?.getAttribute('aria-selected')).toBe('false');
    });

    // notion-motion.md Round 67 §4: that Escape also focuses the Name cell, so keys act on it.
    it('focuses the selected Name cell when Escape closes the right-click Move to picker', async () => {
      const { el } = buildTool(withOtherDatabase(oneRow()), {}, viewData('table'));

      rowEl(el, 'table').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 120 }));
      itemByTitle('tools.database.tableMoveTo').click();
      expect(await moveOptions()).toEqual(['Projects']);
      document.querySelector('[data-blok-database-move-picker] input')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

      const grid = el.querySelector<HTMLElement>('[role="grid"]');
      const nameCell = el.querySelector<HTMLElement>('[data-row-id="a"] [role="gridcell"][data-property-id="title"]');

      expect(nameCell).toHaveFocus();
      expect(grid?.getAttribute('aria-activedescendant')).toBe(nameCell?.id);
    });

    const escapeMovePicker = async (el: HTMLElement): Promise<HTMLElement> => {
      rowEl(el, 'table').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 120 }));
      itemByTitle('tools.database.tableMoveTo').click();
      expect(await moveOptions()).toEqual(['Projects']);
      document.querySelector('[data-blok-database-move-picker] input')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      const grid = el.querySelector<HTMLElement>('[role="grid"]');

      if (grid === null) throw new Error('no grid');

      return grid;
    };
    const selectedRow = (el: HTMLElement): Element | null => el.querySelector('[data-blok-database-table-row][aria-selected="true"]');
    const nameSelected = (el: HTMLElement): boolean => el.querySelector('[data-row-id="a"] [role="gridcell"][data-property-id="title"]')?.getAttribute('aria-selected') === 'true';

    // notion-motion.md Round 67 §4: a second Escape changes nothing. A third: unmeasured.
    it('keeps the Name cell on a second Escape after the right-click Move to picker', async () => {
      const { el } = buildTool(withOtherDatabase(oneRow()), {}, viewData('table'));
      const grid = await escapeMovePicker(el);

      press(grid, 'Escape');

      expect(selectedRow(el)).toBeNull();
      expect(nameSelected(el)).toBe(true);
      expect(el.querySelector('[data-row-id="a"] [role="gridcell"][data-property-id="title"]')).toHaveFocus();
    });

    it('lets Escape select the row again once the cell selection moves', async () => {
      const { el } = buildTool(withOtherDatabase(oneRow()), {}, viewData('table'));
      const grid = await escapeMovePicker(el);

      press(grid, 'ArrowRight');
      press(grid, 'Escape');

      expect(selectedRow(el)).not.toBeNull();
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

  // notion-motion.md Round 60 §4, Round 61 §4: a right-click on a feed card's blank area opens the database
  // block's own menu at the pointer (1px under it, or flipped above), not core's menu 8px under it.
  // Round 60 §4: on the title text Notion shows no menu of its own, so that stays the browser's.
  describe('feed card right-click', () => {
    const feed = (readOnly = false): { el: HTMLElement; toggle: ReturnType<typeof vi.fn> } => {
      const doc = oneRow();
      const toggle = vi.fn();

      Object.assign(doc.api, { toolbar: { toggleBlockSettings: toggle, close: vi.fn() } });
      const { el } = buildTool(doc, {}, viewData('feed'), readOnly);

      return { el, toggle };
    };
    const card = (el: HTMLElement): HTMLElement => {
      const found = el.querySelector<HTMLElement>('[data-blok-database-feed-card][data-row-id="a"]');

      if (found === null) throw new Error('no feed card');

      return found;
    };
    const rightClickAt = (target: Element, clientX: number, clientY: number): { event: MouseEvent; reachedCore: boolean } => {
      const state = { reachedCore: false };
      const core = (): void => {
        state.reachedCore = true;
      };

      document.body.addEventListener('contextmenu', core);
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY });

      target.dispatchEvent(event);
      document.body.removeEventListener('contextmenu', core);

      return { event, reachedCore: state.reachedCore };
    };

    it('opens the database block\'s menu at the pointer, in place of core\'s', () => {
      const { el, toggle } = feed();
      const target = card(el);
      const { event, reachedCore } = rightClickAt(target, 700, 350);

      expect(toggle).toHaveBeenCalledWith(true, target, { at: { x: 700, y: 350 } });
      expect(event.defaultPrevented).toBe(true);
      expect(reachedCore).toBe(false);
    });

    it('leaves a right-click on the title text to the browser', () => {
      const { el, toggle } = feed();
      const title = card(el).querySelector('[data-blok-database-feed-title]');

      if (title === null) throw new Error('no title');
      const { event } = rightClickAt(title, 600, 380);

      expect(toggle).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it('opens nothing of its own for a reader', () => {
      const { el, toggle } = feed(true);

      rightClickAt(card(el), 700, 350);

      expect(toggle).not.toHaveBeenCalled();
    });
  });

  // notion-motion.md Round 16 §6 and Round 17 §2: the feed ⋯ menu's top-left is the click point, 1px down,
  // and it stays 12px above the window bottom.
  describe('feed card ⋯ menu placement', () => {
    const openedAt = (x: number, detail: number): HTMLElement => {
      const { el } = buildTool(oneRow(), {}, viewData('feed'));

      document.body.appendChild(el);
      const button = el.querySelector<HTMLElement>('[data-blok-database-feed-more-actions]');

      if (button === null) throw new Error('no More actions');
      button.getBoundingClientRect = () => new DOMRect(588, 338, 24, 24);
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: 350, detail }));
      const popover = [...document.querySelectorAll<HTMLElement>('[data-blok-popover]')].at(-1);

      if (popover === undefined) throw new Error('no menu');

      return popover;
    };

    it('opens with its top 1px below the click y and its left edge on the click x', () => {
      const popover = openedAt(595, 1);

      expect(popover.style.top).toBe('351px');
      expect(popover.style.left).toBe('595px');
    });

    it('opens from a key press on the button\'s left edge', () => {
      const popover = openedAt(0, 0);

      expect(popover.style.left).toBe('588px');
    });

    it('stays 12px above the window bottom', () => {
      vi.stubGlobal('innerHeight', 340);
      const popover = openedAt(595, 1);

      expect(popover.style.top).toBe(`${340 - 12 - popover.getBoundingClientRect().height}px`);
      vi.unstubAllGlobals();
    });
  });

  // notion-motion.md Round 36 §4 (r36-cardmenu-*.raw): a board card's ⋯ menu opens at the click x, not the button's
  // left; a key press has no pointer, so it keeps the button.
  describe('board card ⋯ menu placement', () => {
    const openedAt = (x: number, detail: number): HTMLElement => {
      const { el } = buildTool(oneRow(), {}, viewData('board'));

      document.body.appendChild(el);
      const button = el.querySelector<HTMLElement>('[data-blok-database-card-menu]');

      if (button === null) throw new Error('no card ⋯');
      button.getBoundingClientRect = () => new DOMRect(588, 338, 28, 24);
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: 350, detail }));
      const popover = [...document.querySelectorAll<HTMLElement>('[data-blok-popover]')].at(-1);

      if (popover === undefined) throw new Error('no menu');

      return popover;
    };

    it('opens with its left edge on the click x', () => {
      expect(openedAt(604, 1).style.left).toBe('604px');
    });

    it('opens from a key press on the button\'s left edge', () => {
      expect(openedAt(0, 0).style.left).toBe('588px');
    });
  });
});
