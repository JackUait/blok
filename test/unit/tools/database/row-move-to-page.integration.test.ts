/**
 * The row menu's "Move to" moves a row to any page, like Notion
 * (notion-motion.md Round 62 §1): a "Move page to…" picker lists the host's
 * pages and the document's other databases. A page target gets the row as a
 * plain page (its properties dropped) through the host's `create`, and the
 * row leaves the table in one undo step.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { DatabaseCommentTool } from '../../../../src/tools/database-comment';
import { PageTool } from '../../../../src/tools/page';
import type { PageConfig, PageCreateInit } from '../../../../src/tools/page/types';
import type { API, OutputBlockData, OutputData } from '../../../../types';
import { announce } from '../../../../src/components/utils/announcer';

vi.mock('../../../../src/components/utils/announcer', async (original) => ({
  ...await original<Record<string, unknown>>(),
  announce: vi.fn(),
}));

interface Runtime {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  history: { undo: () => void; redo: () => void };
  blocks: API['blocks'];
  module: { yjsManager: { stopCapturing: () => void } };
}

let editor: Runtime | undefined;
let holder: HTMLDivElement | undefined;

const settle = (ms = 0): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, ms);
});

const quiet = async (): Promise<void> => {
  await settle();
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  }
  await settle();
};

const view = { id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] };

const database = (id: string, title: string, content: string[]): OutputBlockData => ({
  id,
  type: 'database',
  data: {
    title,
    schema: [
      { id: 't', name: 'Name', type: 'title', position: 'a0' },
      { id: 'notes', name: 'Notes', type: 'text', position: 'a1' },
    ],
    views: [{ ...view, id: `${id}-v` }],
    activeViewId: `${id}-v`,
  },
  content,
});

const BLOCKS: OutputBlockData[] = [
  database('db', 'Tasks', ['r1', 'r2']),
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Alpha', notes: 'short' }, position: 'a0', icon: '🍎' }, content: ['b1', 'c1'] },
  { id: 'b1', type: 'paragraph', parent: 'r1', data: { text: 'row body' } },
  { id: 'c1', type: 'database-comment', parent: 'r1', data: { text: 'a comment', createdAt: 1 } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Beta' }, position: 'a1' } },
];

const PAGES = [
  { pageId: 'p-a', title: 'Target A' },
  { pageId: 'p-b', title: 'Target B', path: ['Home'] },
];

const host = (overrides: Partial<PageConfig> = {}): PageConfig & { create: ReturnType<typeof vi.fn> } => ({
  databasePages: true,
  createFromMention: true,
  search: vi.fn(async (query: string) => PAGES.filter((page) => page.title.toLowerCase().includes(query.toLowerCase()))),
  create: vi.fn(async (_init: PageCreateInit) => undefined),
  ...overrides,
}) as never;

const boot = async (page: PageConfig | undefined, blocks: OutputBlockData[] = BLOCKS, databaseConfig: Record<string, unknown> = {}): Promise<Runtime> => {
  const instance = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      database: { class: DatabaseTool, config: databaseConfig },
      'database-row': DatabaseRowTool,
      'database-comment': DatabaseCommentTool,
      ...(page === undefined ? {} : { page: { class: PageTool, config: page } }),
    },
    data: { blocks: structuredClone(blocks) },
  } as never) as unknown as Runtime;

  editor = instance;
  await instance.isReady;
  await quiet();
  instance.module.yjsManager.stopCapturing();

  return instance;
};

const openRowMenu = async (rowId = 'r1'): Promise<void> => {
  const handle = holder?.querySelector<HTMLElement>(`[data-blok-database-table-row][data-row-id="${rowId}"] [data-blok-database-table-row-handle]`);

  if (handle === null || handle === undefined) throw new Error('no row handle');
  handle.click();
  await quiet();
};

const menuItemTitled = (title: string): HTMLElement | undefined => [...document.querySelectorAll<HTMLElement>('[data-blok-popover-opened="true"] [data-blok-popover-item]')]
  .find((item) => item.querySelector('[data-blok-popover-item-title]')?.textContent === title);

const searchInput = (): HTMLInputElement | null => document.querySelector<HTMLInputElement>('[data-blok-testid="page-picker-search-input"]');

const options = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-blok-database-move-picker] [role="option"]')];

const optionTitled = (title: string): HTMLElement | undefined => options().find((option) => option.textContent?.includes(title));

const openPicker = async (): Promise<void> => {
  await openRowMenu();
  const moveTo = menuItemTitled('Move to');

  if (moveTo === undefined) throw new Error('no Move to');
  moveTo.click();
  await quiet();
};

const pick = async (title: string): Promise<void> => {
  const option = optionTitled(title);

  if (option === undefined) throw new Error(`no option ${title}`);
  option.click();
  await quiet();
  await settle(20);
  await quiet();
};

const rowIds = async (): Promise<string[]> => ((await editor?.save())?.blocks ?? [])
  .filter((block) => block.type === 'database-row').map((block) => block.id ?? '');

describe('row menu › Move to a page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    document.querySelectorAll('[data-blok-popover]').forEach((popover) => popover.remove());
    vi.restoreAllMocks();
  });

  it('offers Move to with no other database when the host can take a page', async () => {
    await boot(host());
    await openRowMenu();

    expect(menuItemTitled('Move to')).toBeDefined();
  });

  it.each([
    ['no page tool', undefined],
    ['a host that does not store parentId', host({ createFromMention: false })],
    ['a host that does not store document', host({ databasePages: false })],
    ['a host without search', host({ search: undefined })],
  ])('has no Move to with %s and no other database', async (_case, page) => {
    await boot(page);
    await openRowMenu();

    expect(menuItemTitled('Move to Trash')).toBeDefined();
    expect(menuItemTitled('Move to')).toBeUndefined();
  });

  it('replaces the row menu with a focused "Move page to…" picker listing the host\'s pages as Suggested', async () => {
    const page = host();

    await boot(page);
    await openPicker();

    expect(menuItemTitled('Move to Trash')).toBeUndefined();
    expect(searchInput()?.placeholder).toBe('Move page to…');
    expect(searchInput()).toHaveFocus();
    expect(page.search).toHaveBeenCalledWith('');
    expect(document.querySelector('[data-blok-database-move-picker] [data-blok-page-picker-section]')?.textContent).toBe('Suggested');
    expect(options().map((option) => option.querySelector('.truncate')?.textContent)).toEqual(['Target A', 'Target B']);
    // R62: at rest nothing is highlighted; ArrowDown starts at the first row and focus stays in the field.
    expect(options().filter((option) => option.getAttribute('aria-selected') === 'true')).toEqual([]);
    searchInput()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(options()[0]?.getAttribute('aria-selected')).toBe('true');
    expect(searchInput()).toHaveFocus();
  });

  it('sends the row\'s body to the host as a plain page under the target and removes the row in one undo step', async () => {
    const page = host();

    await boot(page);
    const { parent: _parent, ...body } = (await editor?.save())?.blocks.find((block) => block.id === 'b1') ?? {};

    await openPicker();
    await pick('Target A');

    expect(page.create).toHaveBeenCalledTimes(1);
    const init = page.create.mock.calls[0][0] as PageCreateInit;

    expect(init.parentId).toBe('p-a');
    expect(init.title).toBe('Alpha');
    // Notion drops every property; the comment thread is not page content.
    expect(init.document).toEqual({ title: 'Alpha', icon: { type: 'emoji', value: '🍎' }, blocks: [body] });
    expect(document.querySelector('[data-blok-database-move-picker]')).toBeNull();
    expect(await rowIds()).toEqual(['r2']);
    expect(announce).toHaveBeenCalledWith('Moved Alpha to Target A');

    editor?.history.undo();
    await quiet();
    const back = (await editor?.save())?.blocks ?? [];

    expect(back.filter((block) => block.type === 'database-row').map((block) => block.id)).toEqual(['r1', 'r2']);
    expect(back.find((block) => block.id === 'b1')?.parent).toBe('r1');

    editor?.history.redo();
    await quiet();
    expect(await rowIds()).toEqual(['r2']);
    expect(page.create).toHaveBeenCalledTimes(1);
  });

  // R62: Suggested listed 9 rows in one scroller, with no "more results" row.
  it('lists every suggested page, without folding the list', async () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ pageId: `p-${index}`, title: `Page ${index}` }));

    await boot(host({ search: vi.fn(async () => many) }));
    await openPicker();

    expect(options()).toHaveLength(10);
    expect(document.querySelector('[data-blok-database-move-picker] [data-blok-testid="page-picker-more"]')).toBeNull();
  });

  it('lists the document\'s other databases and moves the row into one as before', async () => {
    await boot(host(), [...BLOCKS, database('db2', 'Projects', [])]);
    await openPicker();
    await pick('Projects');

    const saved = (await editor?.save())?.blocks ?? [];

    expect(saved.find((block) => block.id === 'r1')?.parent).toBe('db2');
  });

  it('offers the other databases without a page host', async () => {
    await boot(undefined, [...BLOCKS, database('db2', 'Projects', [])]);
    await openPicker();

    expect(options().map((option) => option.textContent)).toEqual(['Projects']);
  });

  it('filters by the typed query and highlights the first result', async () => {
    const page = host();

    await boot(page);
    await openPicker();
    const input = searchInput();

    if (input === null) throw new Error('no field');
    input.value = 'b';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await quiet();

    expect(page.search).toHaveBeenLastCalledWith('b');
    expect(options().map((option) => option.querySelector('.truncate')?.textContent)).toEqual(['Target B']);
    expect(options()[0]?.getAttribute('aria-selected')).toBe('true');
  });

  // Round 62 §1: the rest look (453 tall, full-bleed rows) gives way to the search look with the results.
  it('takes the search look when a query\'s results arrive, and drops it when the query is cleared', async () => {
    const answers: Array<() => void> = [];
    const page = host({
      search: vi.fn((query: string) => new Promise<typeof PAGES>((resolve) => {
        answers.push(() => resolve(PAGES.filter((item) => item.title.toLowerCase().includes(query.toLowerCase()))));
      })),
    });
    const picker = (): Element | null => document.querySelector('[data-blok-database-move-picker]');
    const type = async (value: string): Promise<void> => {
      const input = searchInput();

      if (input === null) throw new Error('no field');
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await quiet();
    };

    await boot(page);
    await openPicker();
    answers.shift()?.();
    await quiet();
    expect(picker()?.hasAttribute('data-blok-database-move-searched')).toBe(false);

    await type('b');
    expect(picker()?.hasAttribute('data-blok-database-move-searched')).toBe(false);
    answers.shift()?.();
    await quiet();
    expect(picker()?.hasAttribute('data-blok-database-move-searched')).toBe(true);

    await type('');
    answers.shift()?.();
    await quiet();
    expect(picker()?.hasAttribute('data-blok-database-move-searched')).toBe(false);
  });

  it('closes on Escape and on a press outside, and moves nothing', async () => {
    const page = host();

    await boot(page);
    await openPicker();
    searchInput()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await quiet();
    expect(document.querySelector('[data-blok-database-move-picker]')).toBeNull();

    await openPicker();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await quiet();
    expect(document.querySelector('[data-blok-database-move-picker]')).toBeNull();
    expect(page.create).not.toHaveBeenCalled();
    expect(await rowIds()).toEqual(['r1', 'r2']);
  });

  it('keeps the row when the host fails to make the page', async () => {
    await boot(host({ create: vi.fn(async () => { throw new Error('offline'); }) }));
    await openPicker();
    await pick('Target A');

    expect(await rowIds()).toEqual(['r1', 'r2']);
    expect(announce).not.toHaveBeenCalledWith(expect.stringContaining('Moved'));
  });

  it('does nothing when the row is gone before the host answers', async () => {
    const answer: { resolve?: () => void } = {};
    const page = host({ create: vi.fn(() => new Promise<void>((resolve) => { answer.resolve = resolve; })) });

    await boot(page);
    await openPicker();
    await pick('Target A');
    const index = editor?.blocks.getBlockIndex('r1');

    if (index === undefined) throw new Error('no r1');
    await editor?.blocks.delete(index);
    await quiet();
    answer.resolve?.();
    await quiet();

    expect(announce).not.toHaveBeenCalledWith(expect.stringContaining('Moved'));
    expect(await rowIds()).toEqual(['r2']);
  });

  it('closes the picker when the editor goes away, and a late answer does nothing', async () => {
    const answer: { resolve?: () => void } = {};

    await boot(host({ create: vi.fn(() => new Promise<void>((resolve) => { answer.resolve = resolve; })) }));
    await openPicker();
    editor?.destroy();
    editor = undefined;
    await quiet();

    expect(document.querySelector('[data-blok-database-move-picker]')).toBeNull();
    answer.resolve?.();
    await quiet();
    expect(announce).not.toHaveBeenCalledWith(expect.stringContaining('Moved'));
  });

  it('does not delete the rows of a database inside the moved body from its backend', async () => {
    const adapter = {
      // Never answers: a load would replace the schema mid-test.
      loadDatabase: vi.fn(() => new Promise<never>(() => undefined)),
      createRow: vi.fn(async (params: { id: string }) => ({ ...params })),
      updateRow: vi.fn(async () => undefined),
      moveRow: vi.fn(async () => undefined),
      deleteRow: vi.fn(async () => undefined),
      createProperty: vi.fn(async (params: { id: string }) => ({ ...params })),
      updateProperty: vi.fn(async () => undefined),
      deleteProperty: vi.fn(async () => undefined),
      createView: vi.fn(async (params: { id: string }) => ({ ...params })),
      updateView: vi.fn(async () => undefined),
      deleteView: vi.fn(async () => undefined),
    };
    const blocks: OutputBlockData[] = [
      ...BLOCKS.map((block) => (block.id === 'r1' ? { ...block, content: ['b1', 'c1', 'ndb'] } : block)),
      { ...database('ndb', 'Inner', ['nr1']), parent: 'r1' },
      { id: 'nr1', type: 'database-row', parent: 'ndb', data: { properties: { t: 'Inner row' }, position: 'a0' } },
    ];

    await boot(host(), blocks, { adapter });
    await openPicker();
    await pick('Target A');
    await settle(50);

    expect(await rowIds()).toEqual(['r2']);
    expect(JSON.stringify(adapter.deleteRow.mock.calls)).toContain('r1');
    expect(JSON.stringify(adapter.deleteRow.mock.calls)).not.toContain('nr1');
  });

  // Notion's handling of sub-items on a move to a page is unread, so nothing but the row leaves.
  it('keeps the row\'s sub-items in the database, no longer under it', async () => {
    const pair = [
      { id: 'parent', name: 'Parent item', type: 'relation', position: 'a2', relation: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: 'children', limit: 1, role: 'parentItem' } },
      { id: 'children', name: 'Sub-items', type: 'relation', position: 'a3', relation: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: 'parent', role: 'subItems' } },
    ];
    const blocks = BLOCKS.map((block) => {
      if (block.id === 'db') return { ...block, data: { ...block.data, schema: [...((block.data as { schema: unknown[] }).schema), ...pair] } };
      if (block.id === 'r1') return { ...block, data: { ...block.data, properties: { t: 'Alpha', parent: [], children: [{ id: 'r2' }] } } };
      if (block.id === 'r2') return { ...block, data: { ...block.data, properties: { t: 'Beta', parent: [{ id: 'r1' }], children: [] } } };

      return block;
    });

    await boot(host(), blocks);
    await openPicker();
    await pick('Target A');

    const saved = (await editor?.save())?.blocks ?? [];

    expect(saved.filter((block) => block.type === 'database-row').map((block) => block.id)).toEqual(['r2']);
    expect((saved.find((block) => block.id === 'r2')?.data as { properties: Record<string, unknown> }).properties.parent).toEqual([]);

    editor?.history.undo();
    await quiet();
    const back = (await editor?.save())?.blocks ?? [];

    expect(back.filter((block) => block.type === 'database-row').map((block) => block.id)).toEqual(['r1', 'r2']);
    expect((back.find((block) => block.id === 'r2')?.data as { properties: Record<string, unknown> }).properties.parent).toEqual([{ id: 'r1' }]);
  });

  it('closes the picker when its row is deleted', async () => {
    await boot(host());
    await openPicker();
    const index = editor?.blocks.getBlockIndex('r1');

    if (index === undefined) throw new Error('no r1');
    await editor?.blocks.delete(index);
    await quiet();

    expect(document.querySelector('[data-blok-database-move-picker]')).toBeNull();
  });

  it('asks the host once when the same row is picked twice before it answers', async () => {
    const answer: { resolve?: () => void } = {};
    const page = host({ create: vi.fn(() => new Promise<void>((resolve) => { answer.resolve = resolve; })) });

    await boot(page);
    await openPicker();
    await pick('Target A');
    await openPicker();
    await pick('Target B');
    answer.resolve?.();
    await quiet();

    expect(page.create).toHaveBeenCalledTimes(1);
  });
});

/**
 * notion-motion.md Round 62 §1 and Round 63 §2: after Suggested, a "Workspace"
 * section lists the top pages as a tree. A row's chevron opens its children
 * under it, one level deeper; the row itself still picks the page.
 */
describe('row menu › Move to › Workspace tree', () => {
  type PageResult = { pageId: string; title: string; access?: 'none' };
  const TREE: Record<string, PageResult[]> = {
    '': [{ pageId: 'w-home', title: 'Home' }, { pageId: 'w-notes', title: 'Notes' }],
    'w-home': [{ pageId: 'w-plans', title: 'Plans' }, { pageId: 'w-secret', title: 'Secret', access: 'none' }],
    'w-plans': [{ pageId: 'w-q1', title: 'Q1' }],
  };
  const children = (): PageConfig['children'] => vi.fn(async (pageId: string | null) => TREE[pageId ?? ''] ?? []);

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    document.querySelectorAll('[data-blok-popover]').forEach((popover) => popover.remove());
    vi.restoreAllMocks();
  });

  const sections = (): Array<string | null> => [...document.querySelectorAll('[data-blok-database-move-picker] [data-blok-page-picker-section]')]
    .map((section) => section.textContent);
  const treeRows = (): HTMLElement[] => options().filter((option) => option.hasAttribute('data-blok-page-picker-tree-row'));
  const treeTitles = (): Array<string | null | undefined> => treeRows().map((row) => row.querySelector('.truncate')?.textContent);
  const chevronOf = (title: string): HTMLElement => {
    const chevron = treeRows().find((row) => row.querySelector('.truncate')?.textContent === title)
      ?.querySelector<HTMLElement>('[data-blok-testid="page-picker-tree-chevron"]');

    if (chevron === null || chevron === undefined) throw new Error(`no chevron on ${title}`);

    return chevron;
  };
  const key = (name: string): void => {
    searchInput()?.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  };

  it('has no Workspace section when the host has no children hook', async () => {
    await boot(host());
    await openPicker();

    expect(sections()).toEqual(['Suggested']);
    expect(treeRows()).toEqual([]);
  });

  it('lists the top pages under "Workspace" after Suggested, each with a chevron', async () => {
    const page = host({ children: children() });

    await boot(page, [...BLOCKS, database('db2', 'Projects', [])]);
    await openPicker();

    expect(page.children).toHaveBeenCalledWith(null);
    expect(sections()).toEqual(['Suggested', 'Workspace']);
    expect(treeTitles()).toEqual(['Home', 'Notes']);
    expect(treeRows().every((row) => row.querySelector('[data-blok-testid="page-picker-tree-chevron"]') !== null)).toBe(true);
    // Suggested rows and the database row keep their look.
    expect(options().filter((option) => !option.hasAttribute('data-blok-page-picker-tree-row'))
      .some((option) => option.querySelector('[data-blok-testid="page-picker-tree-chevron"]') !== null)).toBe(false);
  });

  it('opens a row\'s children under it, one level deeper, and closes them again, without picking', async () => {
    const page = host({ children: children() });

    await boot(page);
    await openPicker();
    chevronOf('Home').click();
    await quiet();

    expect(page.children).toHaveBeenCalledWith('w-home');
    // The denied page is left out.
    expect(treeTitles()).toEqual(['Home', 'Plans', 'Notes']);
    expect(treeRows().map((row) => row.getAttribute('data-blok-page-picker-depth'))).toEqual(['0', '1', '0']);
    expect(treeRows()[0]?.getAttribute('data-blok-page-picker-expanded')).toBe('true');
    expect(document.querySelector('[data-blok-database-move-picker]')).not.toBeNull();
    expect(page.create).not.toHaveBeenCalled();

    chevronOf('Plans').click();
    await quiet();
    expect(treeTitles()).toEqual(['Home', 'Plans', 'Q1', 'Notes']);
    expect(treeRows().map((row) => row.getAttribute('data-blok-page-picker-depth'))).toEqual(['0', '1', '2', '0']);

    chevronOf('Home').click();
    await quiet();
    expect(treeTitles()).toEqual(['Home', 'Notes']);
    expect(treeRows()[0]?.getAttribute('data-blok-page-picker-expanded')).toBe('false');
  });

  it('moves the row to a page picked in the tree', async () => {
    const page = host({ children: children() });

    await boot(page);
    await openPicker();
    chevronOf('Home').click();
    await quiet();
    await pick('Plans');

    const init = page.create.mock.calls[0][0] as PageCreateInit;

    expect(init.parentId).toBe('w-plans');
    expect(announce).toHaveBeenCalledWith('Moved Alpha to Plans');
  });

  it('opens and closes the highlighted row with ArrowRight and ArrowLeft', async () => {
    const page = host({ children: children(), search: vi.fn(async () => []) });

    await boot(page);
    await openPicker();
    key('ArrowDown');
    expect(treeRows()[0]?.getAttribute('aria-selected')).toBe('true');

    key('ArrowRight');
    await quiet();
    expect(treeTitles()).toEqual(['Home', 'Plans', 'Notes']);
    expect(treeRows()[0]?.getAttribute('aria-selected')).toBe('true');

    key('ArrowDown');
    key('ArrowLeft');
    await quiet();
    // Plans has no open children: nothing changes.
    expect(treeTitles()).toEqual(['Home', 'Plans', 'Notes']);

    key('ArrowUp');
    key('ArrowLeft');
    await quiet();
    expect(treeTitles()).toEqual(['Home', 'Notes']);
    expect(treeRows()[0]?.getAttribute('aria-selected')).toBe('true');
    expect(searchInput()).toHaveFocus();
  });

  it('keeps the highlight on the parent when its open children close', async () => {
    const page = host({ children: children(), search: vi.fn(async () => []) });

    await boot(page);
    await openPicker();
    chevronOf('Home').click();
    await quiet();
    key('ArrowDown');
    key('ArrowDown');
    expect(treeRows()[1]?.getAttribute('aria-selected')).toBe('true');

    chevronOf('Home').click();
    await quiet();
    expect(treeRows()[0]?.getAttribute('aria-selected')).toBe('true');
  });

  it('drops an answer that arrives after the row was closed, and shows it once when reopened', async () => {
    const answers: Array<() => void> = [];
    const page = host({
      children: vi.fn((pageId: string | null) => (pageId === null
        ? Promise.resolve(TREE[''])
        : new Promise<readonly PageResult[]>((resolve) => { answers.push(() => resolve(TREE[pageId] ?? [])); }))),
    });

    await boot(page);
    await openPicker();
    chevronOf('Home').click();
    await quiet();
    chevronOf('Home').click();
    await quiet();
    answers.shift()?.();
    await quiet();
    expect(treeTitles()).toEqual(['Home', 'Notes']);

    chevronOf('Home').click();
    await quiet();
    answers.shift()?.();
    await quiet();
    expect(treeTitles()).toEqual(['Home', 'Plans', 'Notes']);
  });

  it('drops an answer that arrives after the picker closed', async () => {
    const answers: Array<() => void> = [];
    const page = host({
      children: vi.fn((pageId: string | null) => new Promise<readonly PageResult[]>((resolve) => { answers.push(() => resolve(TREE[pageId ?? ''] ?? [])); })),
    });

    await boot(page);
    await openPicker();
    searchInput()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await quiet();
    await openPicker();
    answers.shift()?.();
    await quiet();

    // The first picker's answer does not fill the second one.
    expect(sections()).toEqual(['Suggested']);
    answers.shift()?.();
    await quiet();
    expect(treeTitles()).toEqual(['Home', 'Notes']);
  });

  it('shows nothing for a row whose children fail to load, and no section when the top fails', async () => {
    const failing = host({
      children: vi.fn(async (pageId: string | null) => {
        if (pageId === 'w-home') throw new Error('offline');

        return TREE[pageId ?? ''] ?? [];
      }),
    });

    await boot(failing);
    await openPicker();
    chevronOf('Home').click();
    await quiet();
    expect(treeTitles()).toEqual(['Home', 'Notes']);
    expect(document.querySelector('[data-blok-database-move-picker]')).not.toBeNull();

    editor?.destroy();
    document.querySelectorAll('[data-blok-popover]').forEach((popover) => popover.remove());
    await boot(host({ children: vi.fn(async () => { throw new Error('offline'); }) }));
    await openPicker();
    expect(sections()).toEqual(['Suggested']);
  });

  it('hides the Workspace section while a query is typed', async () => {
    await boot(host({ children: children() }));
    await openPicker();
    const input = searchInput();

    if (input === null) throw new Error('no field');
    input.value = 'target';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await quiet();

    expect(sections()).toEqual(['Pages']);
    expect(treeRows()).toEqual([]);
  });
});
