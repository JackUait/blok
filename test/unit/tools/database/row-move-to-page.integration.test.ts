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
