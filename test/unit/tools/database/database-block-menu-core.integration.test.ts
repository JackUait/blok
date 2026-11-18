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
});
