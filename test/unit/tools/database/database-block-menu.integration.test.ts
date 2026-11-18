/**
 * The database block's own rows in core's block menu (notion-motion.md Round 64 §4):
 * Notion groups Turn into page, Lock database (a switch), Rename and Merge with CSV,
 * then Open as page, then core's Copy link, Duplicate, Move to and Delete.
 * Only the rows Blok already backs elsewhere are here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import type { Block } from '../../../../src/components/block';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { PageTool } from '../../../../src/tools/page';
import type { OutputBlockData, OutputData } from '../../../../types';

interface Runtime {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  module: { blockManager: { blocks: Block[] } };
}

type Item = { type?: string; name?: string; title?: string; closeOnActivate?: boolean; isActive?: boolean | (() => boolean); onActivate?: () => unknown };

let editor: Runtime | undefined;
let holder: HTMLDivElement | undefined;

const settle = async (): Promise<void> => {
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  }
};

const database = (extra: Record<string, unknown> = {}): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      title: 'Tasks',
      schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'v', name: 'Feed', type: 'feed', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v',
      ...extra,
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One' }, position: 'a0' } },
];

const boot = async (options: { page?: boolean; readOnly?: boolean } = {}): Promise<Runtime> => {
  const instance = new Blok({
    holder,
    dataModel: 'hierarchical',
    readOnly: options.readOnly === true,
    tools: {
      paragraph: Paragraph,
      database: DatabaseTool,
      'database-row': DatabaseRowTool,
      ...(options.page === true ? { page: { class: PageTool, config: { databasePages: true, create: () => undefined } } } : {}),
    },
    data: { blocks: structuredClone(database()) },
  } as never) as unknown as Runtime;

  editor = instance;
  await instance.isReady;
  await settle();

  return instance;
};

const toolItems = (instance: Runtime): Item[] => {
  const block = instance.module.blockManager.blocks.find(candidate => candidate.id === 'db');

  if (block === undefined) {
    throw new Error('no database block');
  }

  return (block.getTunes().toolTunes ?? []) as Item[];
};

/** Item names, with "|" for a separator. */
const layout = (items: Item[]): string[] => items.map(item => item.type === 'separator' ? '|' : item.name ?? '?');

const item = (instance: Runtime, name: string): Item => {
  const found = toolItems(instance).find(candidate => candidate.name === name);

  if (found === undefined) {
    throw new Error(`no item ${name}`);
  }

  return found;
};

const active = (entry: Item): boolean => typeof entry.isActive === 'function' ? entry.isActive() : entry.isActive === true;

describe('the database block menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    document.body.innerHTML = '';
    window.history.replaceState(null, '', window.location.pathname);
    vi.restoreAllMocks();
  });

  it('lists Notion\'s rows Blok backs, in Notion\'s order and groups', async () => {
    const instance = await boot();

    expect(layout(toolItems(instance))).toEqual(['database-edit-icon', 'database-lock', 'database-rename', 'database-merge-csv', '|', 'database-open-as-page', 'database-open-in-new-tab']);
    expect(toolItems(instance).map(entry => entry.title)).toEqual(['Edit icon', 'Lock database', 'Rename', 'Merge with CSV', undefined, 'Open as page', 'Open in new tab']);
  });

  it('puts Turn into page first when a page host is there', async () => {
    const instance = await boot({ page: true });

    expect(layout(toolItems(instance))[0]).toBe('database-turn-into-page');
    expect(layout(toolItems(instance))[1]).toBe('database-edit-icon');
  });

  it('Lock database is a switch: it toggles in place and saves the lock', async () => {
    const instance = await boot();
    const lock = item(instance, 'database-lock');

    expect(lock.closeOnActivate).not.toBe(true);
    expect(active(lock)).toBe(false);

    lock.onActivate?.();
    await settle();

    expect(active(lock)).toBe(true);
    const saved = (await instance.save()).blocks.find(block => block.id === 'db');
    const schema = saved?.data.schema as Array<{ type: string; databaseLocked?: boolean }>;

    expect(schema.find(property => property.type === 'title')?.databaseLocked).toBe(true);

    lock.onActivate?.();
    await settle();

    expect(active(lock)).toBe(false);
  });

  it('Merge with CSV leaves a locked database, and a lock set from the open menu stops it', async () => {
    const instance = await boot();
    const merge = item(instance, 'database-merge-csv');
    const dialog = (): Element | null => document.querySelector('[data-blok-testid="database-csv-import-dialog"]');

    item(instance, 'database-lock').onActivate?.();
    await settle();

    expect(layout(toolItems(instance))).not.toContain('database-merge-csv');
    merge.onActivate?.();
    expect(dialog()).toBeNull();

    item(instance, 'database-lock').onActivate?.();
    await settle();
    merge.onActivate?.();
    expect(dialog()).not.toBeNull();
  });

  it('Rename puts the caret at the end of the title', async () => {
    const instance = await boot();
    const rename = item(instance, 'database-rename');

    expect(rename.closeOnActivate).toBe(true);
    rename.onActivate?.();

    const title = holder?.querySelector('[data-blok-database-title]');

    expect(title).toHaveFocus();
    const selection = window.getSelection();

    expect(selection?.isCollapsed).toBe(true);
    expect(selection?.anchorNode !== null && title?.contains(selection?.anchorNode ?? null)).toBe(true);
  });

  it('Open as page opens the database full page, as ⤢ does', async () => {
    const instance = await boot();

    item(instance, 'database-open-as-page').onActivate?.();
    await settle();

    expect(window.location.hash).toBe('#db?full');
  });

  it('Open in new tab opens the database\'s full-page link in a new tab', async () => {
    const instance = await boot();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    item(instance, 'database-open-in-new-tab').onActivate?.();

    expect(open).toHaveBeenCalledExactlyOnceWith(`${window.location.href.split('#')[0]}#db?full`, '_blank', 'noopener');
    expect(window.location.hash).toBe('');
  });

  it('has no Open in new tab when the host opens full pages itself: there is no link to open', async () => {
    holder?.remove();
    holder = document.createElement('div');
    document.body.appendChild(holder);
    const instance = new Blok({
      holder,
      dataModel: 'hierarchical',
      tools: { paragraph: Paragraph, database: { class: DatabaseTool, config: { openFullPage: () => undefined } }, 'database-row': DatabaseRowTool },
      data: { blocks: structuredClone(database()) },
    } as never) as unknown as Runtime;

    editor = instance;
    await instance.isReady;
    await settle();

    expect(layout(toolItems(instance))).toContain('database-open-as-page');
    expect(layout(toolItems(instance))).not.toContain('database-open-in-new-tab');
  });

  it('takes a 265px menu with 28px rows, like Notion\'s (notion-motion.md Round 65 §1)', () => {
    expect((DatabaseTool as unknown as { blockMenu: unknown }).blockMenu).toEqual({ class: 'blok-database-block-menu', minWidth: '265px', trash: true, trashToast: false });
  });

  it('Delete asks first in Notion\'s "Move database to Trash?" dialog, and Cancel keeps it', async () => {
    const instance = await boot();
    const block = instance.module.blockManager.blocks.find(candidate => candidate.id === 'db');
    const answer = block?.confirmDelete();
    const dialog = await vi.waitFor(() => {
      const found = document.querySelector('[data-blok-database-confirm-dialog]');

      if (found === null) throw new Error('no dialog');

      return found;
    });
    const actions = [...dialog.querySelectorAll<HTMLButtonElement>('[data-blok-database-confirm-action]')];

    expect(dialog.querySelector('[data-blok-database-confirm-title]')?.textContent).toBe('Move database to Trash?');
    expect(dialog.querySelector('[data-blok-database-confirm-description]')?.textContent).toBe('All pages will be moved to Trash');
    expect(actions.map(action => action.textContent)).toEqual(['Move to Trash', 'Cancel']);
    expect(actions[0]).toHaveFocus();
    expect(actions[0].hasAttribute('data-destructive') && actions[0].hasAttribute('data-filled')).toBe(true);
    expect(dialog.hasAttribute('data-trash')).toBe(true);

    actions[1].click();

    await expect(answer).resolves.toBe(false);
  });

  it('Move to Trash in the dialog answers yes', async () => {
    const instance = await boot();
    const block = instance.module.blockManager.blocks.find(candidate => candidate.id === 'db');
    const answer = block?.confirmDelete();
    const confirm = await vi.waitFor(() => {
      const found = document.querySelector<HTMLButtonElement>('[data-blok-database-confirm-action="confirm"]');

      if (found === null) throw new Error('no dialog');

      return found;
    });

    confirm.click();

    await expect(answer).resolves.toBe(true);
  });

  it('a linked view does not ask: it has no pages of its own to trash', async () => {
    holder?.remove();
    holder = document.createElement('div');
    document.body.appendChild(holder);
    const instance = new Blok({
      holder,
      dataModel: 'hierarchical',
      tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
      data: { blocks: [...structuredClone(database()), { id: 'linked', type: 'database', data: { title: '', source: { databaseId: 'db' }, views: [], activeViewId: '' } }] },
    } as never) as unknown as Runtime;

    editor = instance;
    await instance.isReady;
    await settle();
    const linked = instance.module.blockManager.blocks.find(candidate => candidate.id === 'linked');

    await expect(linked?.confirmDelete()).resolves.toBe(true);
    expect(document.querySelector('[data-blok-database-confirm-dialog]')).toBeNull();
  });

  // notion-motion.md Round 66 §2: a linked view goes at once, with no dialog.
  it('Backspace on a selected linked view deletes it without asking, and undo brings it back', async () => {
    holder?.remove();
    holder = document.createElement('div');
    document.body.appendChild(holder);
    const instance = new Blok({
      holder,
      dataModel: 'hierarchical',
      tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
      data: { blocks: [...structuredClone(database()), { id: 'linked', type: 'database', data: { title: '', source: { databaseId: 'db' }, views: [], activeViewId: '' } }] },
    } as never) as unknown as Runtime & {
      history: { undo: () => void };
      module: { blockSelection: { selectBlock: (block: Block) => void } };
    };

    editor = instance;
    await instance.isReady;
    await settle();
    const linked = instance.module.blockManager.blocks.find(candidate => candidate.id === 'linked');

    if (linked === undefined) throw new Error('no linked view');
    instance.module.blockSelection.selectBlock(linked);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    await settle();

    expect(document.querySelector('[data-blok-database-confirm-dialog]')).toBeNull();
    expect(instance.module.blockManager.blocks.map(candidate => candidate.id)).not.toContain('linked');

    instance.history.undo();
    await vi.waitFor(() => expect(instance.module.blockManager.blocks.map(candidate => candidate.id)).toContain('linked'));
  });

  // notion-motion.md Round 66 §2: Backspace on the selected database asks too; Escape keeps it selected.
  it('Backspace on the selected database asks, Escape keeps it selected, and a yes undoes with its rows', async () => {
    const instance = await boot() as Runtime & {
      history: { undo: () => void };
      module: { blockSelection: { selectBlock: (block: Block) => void } };
    };
    const dialog = async (): Promise<HTMLButtonElement> => vi.waitFor(() => {
      const found = document.querySelector<HTMLButtonElement>('[data-blok-database-confirm-action="confirm"]');

      if (found === null) throw new Error('no dialog');

      return found;
    });
    const ids = (): string[] => instance.module.blockManager.blocks.map(candidate => candidate.id);
    const database = (): Block | undefined => instance.module.blockManager.blocks.find(candidate => candidate.id === 'db');
    const select = (): void => {
      const found = database();

      if (found === undefined) throw new Error('no database');
      instance.module.blockSelection.selectBlock(found);
    };

    select();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    const escapeAt = await dialog();

    expect(ids()).toContain('db');
    escapeAt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    // The answer lands a task after the key that gave it.
    await settle();
    expect(database()?.selected).toBe(true);
    expect(ids()).toEqual(['db', 'r1']);

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    const confirm = await dialog();
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

    confirm.dispatchEvent(enter);
    // Enter must stay the button's, or its click never comes.
    expect(enter.defaultPrevented).toBe(false);
    confirm.click();
    await vi.waitFor(() => expect(ids()).not.toContain('db'));

    instance.history.undo();
    await vi.waitFor(() => expect(ids()).toEqual(expect.arrayContaining(['db', 'r1'])));
  });

  it('a reader gets none of them', async () => {
    const instance = await boot({ readOnly: true });

    expect(layout(toolItems(instance))).not.toContain('database-lock');
    expect(layout(toolItems(instance))).not.toContain('database-rename');
    expect(layout(toolItems(instance))).not.toContain('database-merge-csv');
  });
});
