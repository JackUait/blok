/**
 * The database block menu as core lays it out (notion-motion.md Round 66 §1):
 * Copy link · Duplicate › · Move to · Move to Trash in one group.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import { destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';
import type { OutputBlockData } from '../../../../types';

let holder: HTMLDivElement | undefined;
let core: Core | undefined;

const quiet = async (): Promise<void> => {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  for (let frame = 0; frame < 3; frame++) {
    await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
  }
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
};

const schema: PropertyDefinition[] = [{ id: 't', name: 'Name', type: 'title', position: 'a0' }];
const viewOf = (id: string): DatabaseViewConfig => ({ id, name: 'Table', type: 'table', position: 'a0', filters: [], sorts: [], visibleProperties: [] });

const databaseBlocks = (id: string, rows: string[]): OutputBlockData[] => [
  { id, type: 'database', content: rows, data: { title: id, schema, views: [viewOf(`${id}-v`)], activeViewId: `${id}-v` } },
  ...rows.map((row, index) => ({ id: row, type: 'database-row', parent: id, data: { properties: { t: row }, position: `a${index}` } })),
];

/** A database with a filter, a sort, a manual row order and a template, beside a paragraph. */
const setUpDatabase = (): OutputBlockData[] => [
  {
    id: 'db', type: 'database', content: ['r1', 'r2', 'tpl'],
    data: {
      title: 'Tasks',
      schema,
      views: [
        { ...viewOf('v1'), filters: [{ id: 'f1', propertyId: 't', operator: 'contains', value: 'note' }], sorts: [{ propertyId: 't', direction: 'desc' }], rowOrder: { r1: 'a1', r2: 'a0' } },
        { ...viewOf('v2'), name: 'Board', type: 'board' },
      ],
      activeViewId: 'v1',
    },
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Alpha note' }, position: 'a0' } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Beta note' }, position: 'a1' } },
  { id: 'tpl', type: 'database-row', parent: 'db', data: { properties: { t: 'Template' }, position: 'a2', template: true } },
  { id: 'p', type: 'paragraph', data: { text: 'after' } },
];

/** Opens Duplicate's submenu and returns its rows. */
const duplicateSubmenu = async (instance: Core, id: string): Promise<HTMLElement[]> => {
  const rows = await openMenu(instance, id);

  rows.find((row) => row.getAttribute('data-blok-item-name') === 'duplicate')?.click();

  return vi.waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>('[data-blok-item-name^="duplicate-with"]')];

    if (found.length === 0) throw new Error('no Duplicate submenu');

    return found;
  });
};

const boot = async (blocks: OutputBlockData[]): Promise<Core> => {
  holder = document.createElement('div');
  document.body.appendChild(holder);
  const instance = new Core({
    holder, tabSync: false, dataModel: 'hierarchical', i18n: { locale: 'en' },
    tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
    data: { blocks },
  });

  core = instance;
  await instance.isReady;
  await quiet();

  return instance;
};

const block = (instance: Core, id: string): NonNullable<ReturnType<Core['moduleInstances']['BlockManager']['getBlockById']>> => {
  const found = instance.moduleInstances.BlockManager.getBlockById(id);

  if (found === undefined) throw new Error(`missing block ${id}`);

  return found;
};

/** The open block menu's rows, "|" for a separator. */
const openMenu = async (instance: Core, id: string): Promise<HTMLElement[]> => {
  await instance.moduleInstances.BlockSettings.open(block(instance, id));

  return vi.waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>('[data-blok-testid="block-tunes-popover"] > [data-blok-popover-container] > [data-blok-popover-items] > :is([data-blok-item-name], [data-blok-popover-item-separator])')];

    if (found.length === 0) throw new Error('block menu did not open');

    return found;
  });
};

const names = (rows: HTMLElement[]): string[] => rows.map((row) => row.hasAttribute('data-blok-popover-item-separator') ? '|' : row.getAttribute('data-blok-item-name') ?? '?');

const hasMarkDestroyed = (value: unknown): value is { markDestroyed(): void } =>
  typeof value === 'object' && value !== null && 'markDestroyed' in value && typeof value.markDestroyed === 'function';
const hasDestroy = (value: unknown): value is { destroy(): void | Promise<void> } =>
  typeof value === 'object' && value !== null && 'destroy' in value && typeof value.destroy === 'function';

const destroyCore = async (instance: Core): Promise<void> => {
  const modules: unknown[] = Object.values(instance.moduleInstances);

  modules.filter(hasMarkDestroyed).forEach((module) => module.markDestroyed());
  await Promise.all(modules.filter(hasDestroy).map((module) => module.destroy()));
};

describe('the database block menu in core', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
  });

  afterEach(async () => {
    core?.moduleInstances.BlockSettings.close();
    if (core !== undefined) await destroyCore(core);
    core = undefined;
    holder?.remove();
    holder = undefined;
    destroyTooltip();
    document.body.innerHTML = '';
    Reflect.deleteProperty(document, 'elementFromPoint');
    vi.restoreAllMocks();
  });

  it('reads Move to Trash right after Duplicate, in the same group, like Notion', async () => {
    const instance = await boot(databaseBlocks('db', ['r1']));
    const rows = await openMenu(instance, 'db');
    const order = names(rows);
    const trash = rows.find((row) => row.getAttribute('data-blok-item-name') === 'delete');

    expect(trash?.textContent).toContain('Move to Trash');
    expect(order.slice(order.indexOf('copy-link'), order.indexOf('delete') + 1)).toEqual(['copy-link', 'duplicate', 'delete']);
  });

  it('Move to Trash shows no toast, as Notion shows none for a database', async () => {
    const instance = await boot(databaseBlocks('db', ['r1']));
    const show = vi.spyOn(instance.moduleInstances.NotifierAPI, 'show');
    const rows = await openMenu(instance, 'db');

    rows.find((row) => row.getAttribute('data-blok-item-name') === 'delete')?.click();
    const confirm = await vi.waitFor(() => {
      const found = document.querySelector<HTMLButtonElement>('[data-blok-database-confirm-action="confirm"]');

      if (found === null) throw new Error('no dialog');

      return found;
    });

    confirm.click();
    await vi.waitFor(() => expect(instance.moduleInstances.BlockManager.getBlockById('db')).toBeUndefined());
    await quiet();

    expect(show).not.toHaveBeenCalled();
  });

  it('Duplicate opens Notion\'s submenu: with content, then without content', async () => {
    const instance = await boot(setUpDatabase());
    const rows = await duplicateSubmenu(instance, 'db');

    expect(rows.map((row) => row.getAttribute('data-blok-item-name'))).toEqual(['duplicate-with-content', 'duplicate-without-content']);
    expect(rows.map((row) => row.querySelector('[data-blok-testid="popover-item-title"]')?.textContent)).toEqual(['Duplicate with content', 'Duplicate without content']);
    expect(rows.every((row) => row.querySelector('[data-blok-testid="popover-item-secondary-title"]') !== null)).toBe(true);
  });

  it('Duplicate without content copies views, columns, filter and sort but no rows, and selects the copy', async () => {
    const instance = await boot(setUpDatabase());
    const before = (await instance.moduleInstances.Saver.save())?.blocks.map((saved) => saved.id) ?? [];

    (await duplicateSubmenu(instance, 'db')).find((row) => row.getAttribute('data-blok-item-name') === 'duplicate-without-content')?.click();

    const copy = await vi.waitFor(() => {
      const found = instance.moduleInstances.BlockManager.blocks.find((candidate) => candidate.name === 'database' && candidate.id !== 'db');

      if (found === undefined) throw new Error('no copy yet');

      return found;
    });
    const saved = (await instance.moduleInstances.Saver.save())?.blocks ?? [];
    const copyData = saved.find((entry) => entry.id === copy.id)?.data as { views: DatabaseViewConfig[]; schema: PropertyDefinition[] };
    const copyRows = saved.filter((entry) => entry.parent === copy.id && entry.type === 'database-row');

    expect(copyRows.filter((row) => (row.data as { template?: boolean }).template !== true)).toEqual([]);
    expect(copyData.views.map((view) => view.type)).toEqual(['table', 'board']);
    expect(copyData.views[0].filters).toHaveLength(1);
    expect(copyData.views[0].sorts).toHaveLength(1);
    expect(copyData.schema.map((property) => property.name)).toEqual(['Name']);
    // No id of the original's rows stays in the copy.
    expect(JSON.stringify(saved.filter((entry) => !before.includes(entry.id ?? '')))).not.toMatch(/"r1"|"r2"/);
    await vi.waitFor(() => expect(copy.selected).toBe(true));
    expect(block(instance, 'db').selected).toBe(false);
    expect(saved.filter((entry) => entry.parent === 'db')).toHaveLength(3);
  });

  it('Duplicate without content puts the copy after the original\'s rows, not between it and them', async () => {
    const instance = await boot([...databaseBlocks('db', ['r1', 'r2']), { id: 'p', type: 'paragraph', data: { text: 'after' } }]);

    (await duplicateSubmenu(instance, 'db')).find((row) => row.getAttribute('data-blok-item-name') === 'duplicate-without-content')?.click();

    const copy = await vi.waitFor(() => {
      const found = instance.moduleInstances.BlockManager.blocks.find((candidate) => candidate.name === 'database' && candidate.id !== 'db');

      if (found === undefined) throw new Error('no copy yet');

      return found;
    });

    expect(instance.moduleInstances.BlockManager.blocks.map((entry) => entry.id)).toEqual(['db', 'r1', 'r2', copy.id, 'p']);
    expect(copy.contentIds).toEqual([]);
  });

  it('Duplicate with content copies the rows too', async () => {
    const instance = await boot(setUpDatabase());

    (await duplicateSubmenu(instance, 'db')).find((row) => row.getAttribute('data-blok-item-name') === 'duplicate-with-content')?.click();

    const copy = await vi.waitFor(() => {
      const found = instance.moduleInstances.BlockManager.blocks.find((candidate) => candidate.name === 'database' && candidate.id !== 'db');

      if (found === undefined) throw new Error('no copy yet');

      return found;
    });

    expect(copy.contentIds).toHaveLength(3);
  });

  /** notion-motion.md Round 67 §1: the copy reads " (1)"; a title ending " (n)" goes to n + 1, taken or not. */
  const copyTitle = async (title: string, without = false): Promise<unknown> => {
    const blocks = setUpDatabase();

    blocks[0] = { ...blocks[0], data: { ...blocks[0].data, title } };
    const instance = await boot(blocks);

    (await duplicateSubmenu(instance, 'db')).find((row) => row.getAttribute('data-blok-item-name') === (without ? 'duplicate-without-content' : 'duplicate-with-content'))?.click();
    const copy = await vi.waitFor(() => {
      const found = instance.moduleInstances.BlockManager.blocks.find((candidate) => candidate.name === 'database' && candidate.id !== 'db');

      if (found === undefined) throw new Error('no copy yet');

      return found;
    });

    return (await copy.save())?.data.title;
  };

  it('Duplicate titles the copy " (1)", like Notion', async () => {
    expect(await copyTitle('Tasks')).toBe('Tasks (1)');
  });

  it('Duplicate without content titles the copy " (1)" too', async () => {
    expect(await copyTitle('Tasks', true)).toBe('Tasks (1)');
  });

  it('Duplicate of "Tasks (2)" is "Tasks (3)"', async () => {
    expect(await copyTitle('Tasks (2)')).toBe('Tasks (3)');
  });

  it('a linked view\'s Duplicate has no submenu, as in Notion', async () => {
    const instance = await boot([...setUpDatabase(), { id: 'linked', type: 'database', data: { title: '', source: { databaseId: 'db' }, views: [], activeViewId: '' } }]);
    const rows = await openMenu(instance, 'linked');
    const duplicate = rows.find((row) => row.getAttribute('data-blok-item-name') === 'duplicate');

    duplicate?.click();
    await quiet();

    expect(document.querySelector('[data-blok-item-name="duplicate-without-content"]')).toBeNull();
  });

  it('Cmd+Shift+D on a selected database duplicates it without content', async () => {
    const instance = await boot(setUpDatabase());

    instance.moduleInstances.BlockSelection.selectBlock(block(instance, 'db'));
    const event = new KeyboardEvent('keydown', { key: 'D', code: 'KeyD', metaKey: true, shiftKey: true, bubbles: true, cancelable: true });

    document.body.dispatchEvent(event);

    const copy = await vi.waitFor(() => {
      const found = instance.moduleInstances.BlockManager.blocks.find((candidate) => candidate.name === 'database' && candidate.id !== 'db');

      if (found === undefined) throw new Error('no copy yet');

      return found;
    });

    expect(event.defaultPrevented).toBe(true);
    expect(copy.contentIds).toEqual(copy.contentIds.filter((id) => instance.moduleInstances.BlockManager.getBlockById(id)?.preservedData.template === true));
  });

  it('Cmd+Shift+D also works when the selection holds the database\'s rows with it', async () => {
    const instance = await boot(setUpDatabase());

    ['db', 'r1', 'r2', 'tpl'].forEach((id) => instance.moduleInstances.BlockSelection.selectBlock(block(instance, id)));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'D', code: 'KeyD', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));

    const copy = await vi.waitFor(() => {
      const found = instance.moduleInstances.BlockManager.blocks.find((candidate) => candidate.name === 'database' && candidate.id !== 'db');

      if (found === undefined) throw new Error('no copy yet');

      return found;
    });

    expect(copy.contentIds).toHaveLength(1);
  });

  it('Cmd+Shift+D on a selected paragraph is left to the browser', async () => {
    const instance = await boot(setUpDatabase());

    instance.moduleInstances.BlockSelection.selectBlock(block(instance, 'p'));
    const event = new KeyboardEvent('keydown', { key: 'D', code: 'KeyD', metaKey: true, shiftKey: true, bubbles: true, cancelable: true });

    document.body.dispatchEvent(event);
    await quiet();

    expect(event.defaultPrevented).toBe(false);
    expect(instance.moduleInstances.BlockManager.blocks.filter((candidate) => candidate.name === 'paragraph')).toHaveLength(1);
  });

  it('has no Move to when the only pages are its own rows', async () => {
    const instance = await boot(databaseBlocks('db', ['r1']));

    expect(names(await openMenu(instance, 'db'))).not.toContain('move-to');
  });

  it('offers Move to when another database\'s row can take it', async () => {
    const instance = await boot([...databaseBlocks('db', ['r1']), ...databaseBlocks('other', ['o1'])]);

    expect(names(await openMenu(instance, 'db'))).toContain('move-to');
  });

  it('Move to puts the database and its rows in the picked page, and deletes no row', async () => {
    const instance = await boot([...databaseBlocks('db', ['r1']), ...databaseBlocks('other', ['o1'])]);
    const removed = vi.spyOn(DatabaseTool.prototype, 'removed');
    const rows = await openMenu(instance, 'db');

    rows.find((row) => row.getAttribute('data-blok-item-name') === 'move-to')?.click();
    const option = await vi.waitFor(() => {
      const found = [...document.querySelectorAll<HTMLElement>('[data-blok-testid="page-picker-option"]')].find((candidate) => candidate.textContent?.includes('o1') ?? false);

      if (found === undefined) throw new Error('no picker option');

      return found;
    });

    option.click();
    // The pick waits for the move flight.
    await vi.waitFor(() => expect(block(instance, 'db').parentId).toBe('o1'), { timeout: 5000 });

    expect(block(instance, 'r1').parentId).toBe('db');
    expect(removed).not.toHaveBeenCalled();
  });

  // notion-motion.md Round 67 §1: a locked database's menu keeps only the open rows and Copy link.
  it('a locked database leaves out Edit icon, Lock, Rename, Merge, Duplicate, Move to and Move to Trash', async () => {
    const locked = databaseBlocks('db', ['r1']);

    locked[0].data = { ...locked[0].data, schema: [{ ...schema[0], databaseLocked: true }] };
    const instance = await boot([...locked, ...databaseBlocks('other', ['o1'])]);
    const order = names(await openMenu(instance, 'db'));

    ['database-edit-icon', 'database-lock', 'database-rename', 'database-merge-csv', 'duplicate', 'move-to', 'delete']
      .forEach((name) => expect(order).not.toContain(name));
    expect(order).toEqual(expect.arrayContaining(['database-open-as-page', 'database-open-in-new-tab', 'copy-link']));
  });

  it('an unlocked database keeps them', async () => {
    const instance = await boot([...databaseBlocks('db', ['r1']), ...databaseBlocks('other', ['o1'])]);
    const order = names(await openMenu(instance, 'db'));

    expect(order).toEqual(expect.arrayContaining(['database-edit-icon', 'database-lock', 'database-rename', 'duplicate', 'move-to', 'delete']));
  });

  // notion-motion.md Round 67 §2: Notion keeps the database selected while its trash dialog is open.
  it('keeps the database selected while the menu\'s trash dialog is open', async () => {
    const instance = await boot(databaseBlocks('db', ['r1']));

    // As after ↑ or a click: the selected database is the current block.
    instance.moduleInstances.BlockManager.currentBlock = block(instance, 'db');
    instance.moduleInstances.BlockSelection.selectBlock(block(instance, 'db'));
    (await openMenu(instance, 'db')).find((row) => row.getAttribute('data-blok-item-name') === 'delete')?.click();
    await vi.waitFor(() => {
      if (document.querySelector('[data-blok-database-confirm-action="confirm"]') === null) throw new Error('no dialog');
    });
    await quiet();

    expect(block(instance, 'db').selected).toBe(true);
  });

  describe('the trash question for a selection of databases (notion-motion.md Round 67 §2)', () => {
    /** Selects the blocks, presses Backspace and returns the dialog's description. */
    const ask = async (instance: Core, ids: string[]): Promise<string | null | undefined> => {
      ids.forEach((id) => instance.moduleInstances.BlockSelection.selectBlock(block(instance, id)));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));

      return vi.waitFor(() => {
        const found = document.querySelector('[data-blok-database-confirm-description]');

        if (found === null) throw new Error('no dialog');

        return found.textContent;
      });
    };

    it('counts the data sources of two databases', async () => {
      const instance = await boot([...databaseBlocks('a', ['a1']), ...databaseBlocks('b', ['b1'])]);

      expect(await ask(instance, ['a', 'b'])).toBe('2 data sources and all of their pages will be moved to Trash');
    });

    it('counts a second data source inside a database', async () => {
      const second = databaseBlocks('src2', ['s1']).map((entry) => entry.id === 'src2' ? { ...entry, parent: 'a' } : entry);
      const first = databaseBlocks('a', ['a1']);

      first[0].content = ['a1', 'src2'];
      const instance = await boot([...first, ...second]);

      expect(await ask(instance, ['a'])).toBe('2 data sources and all of their pages will be moved to Trash');
    });

    it('keeps "All pages" for one database with one source', async () => {
      const instance = await boot(databaseBlocks('a', ['a1']));

      expect(await ask(instance, ['a'])).toBe('All pages will be moved to Trash');
    });

    it('asks when a linked view comes first in a selection that holds a database', async () => {
      const instance = await boot([
        { id: 'linked', type: 'database', data: { title: '', source: { databaseId: 'a' }, views: [], activeViewId: '' } },
        ...databaseBlocks('a', ['a1']),
      ]);

      expect(await ask(instance, ['linked', 'a'])).toBe('All pages will be moved to Trash');
    });
  });
});
