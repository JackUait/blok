/**
 * "Turn into page" on an inline database (Notion: research-live-notion.md §4)
 * moves the database, its rows and their bodies into a new page, and leaves a
 * database page link in its place. The move spans two documents, so it must
 * undo as ONE step in this one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import type { Block } from '../../../../src/components/block';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { PageTool } from '../../../../src/tools/page';
import { Toggle } from '../../../../src/tools';
import type { PageConfig } from '../../../../src/tools/page/types';
import type { API, OutputBlockData, OutputData } from '../../../../types';

interface Runtime {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  history: { undo: () => void; redo: () => void; canUndo: () => boolean; canRedo: () => boolean };
  blocks: API['blocks'];
  module: {
    blockManager: { blocks: Block[] };
    yjsManager: { stopCapturing: () => void };
  };
}

type Item = { name?: string; title?: string; onActivate?: () => unknown };

let editor: Runtime | undefined;
let holder: HTMLDivElement | undefined;

const settle = (ms = 0): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, ms);
});

const settleFrame = async (): Promise<void> => {
  await settle();
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  }
  await settle();
};

const BLOCKS: OutputBlockData[] = [
  { id: 'a', type: 'paragraph', data: { text: 'before' } },
  {
    id: 'db',
    type: 'database',
    data: {
      title: 'Tasks',
      schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v',
    },
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One' }, position: 'a0' }, content: ['b1'] },
  { id: 'b1', type: 'paragraph', parent: 'r1', data: { text: 'row body' } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Two' }, position: 'a1' } },
  { id: 'z', type: 'paragraph', data: { text: 'after' } },
];

const boot = async (page: PageConfig, database: Record<string, unknown> = {}, blocks: OutputBlockData[] = BLOCKS): Promise<Runtime> => {
  const instance = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      toggle: Toggle,
      database: { class: DatabaseTool, config: database },
      'database-row': DatabaseRowTool,
      page: { class: PageTool, config: page },
    },
    data: { blocks: structuredClone(blocks) },
  } as never) as unknown as Runtime;

  editor = instance;
  await instance.isReady;
  await settleFrame();
  instance.module.yjsManager.stopCapturing();

  return instance;
};

const step = async (instance: Runtime, action: () => unknown): Promise<void> => {
  await action();
  await settleFrame();
  await settle(50);
  await settleFrame();
  instance.module.yjsManager.stopCapturing();
};

/** id, parent and data of every saved block. */
const saved = async (instance: Runtime): Promise<string> => {
  const output = await instance.save();

  return JSON.stringify(output.blocks.map(block => [block.id, block.parent ?? null, block.type, block.data]));
};

const toolItems = (instance: Runtime, id: string): Item[] => {
  const block = instance.module.blockManager.blocks.find(candidate => candidate.id === id);

  if (block === undefined) {
    throw new Error(`no block ${id}`);
  }

  return block.getTunes().toolTunes as Item[];
};

const turnIntoPage = (instance: Runtime): Item | undefined =>
  toolItems(instance, 'db').find(item => item.name === 'database-turn-into-page');

describe('Turn into page on an inline database', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    editor?.destroy();
    await settle();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('moves the database into a new page and undoes as one step', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const instance = await boot({ databasePages: true, create });
    const before = await saved(instance);
    const item = turnIntoPage(instance);

    expect(item?.title).toBe('Turn into page');

    await step(instance, () => item?.onActivate?.());

    // The new page holds the whole subtree, same ids, as a full-page database.
    expect(create).toHaveBeenCalledTimes(1);
    const init = create.mock.calls[0][0] as { pageId: string; title?: string; document?: OutputData };
    const moved = init.document?.blocks ?? [];

    expect(init.title).toBe('Tasks');
    expect(init.document?.title).toBe('Tasks');
    expect(moved.map(block => [block.id, block.parent ?? null])).toEqual([
      ['db', null], ['r1', 'db'], ['b1', 'r1'], ['r2', 'db'],
    ]);
    expect(moved[0].data).toMatchObject({ title: 'Tasks', fullPage: true });

    // The parent keeps a database page link in the same place.
    const after = await instance.save();

    expect(after.blocks.map(block => [block.type, block.parent ?? null])).toEqual([
      ['paragraph', null], ['page', null], ['paragraph', null],
    ]);
    expect(after.blocks[1].data).toEqual({ pageId: init.pageId, kind: 'database' });

    // One undo brings the inline database back, rows and bodies included.
    await step(instance, () => instance.history.undo());
    expect(await saved(instance)).toBe(before);

    // Redo puts the same link back; the host makes no second page.
    await step(instance, () => instance.history.redo());
    const redone = await instance.save();

    expect(redone.blocks.map(block => block.type)).toEqual(['paragraph', 'page', 'paragraph']);
    expect(redone.blocks[1].data).toEqual({ pageId: init.pageId, kind: 'database' });
    expect(create).toHaveBeenCalledTimes(1);
  }, 30_000);

  it('leaves the link inside the same parent', async () => {
    const nested: OutputBlockData[] = [
      { id: 'tg', type: 'toggle', data: { text: 'box' }, content: ['a', 'db', 'z'] },
      ...BLOCKS.map(block => block.parent === undefined ? { ...block, parent: 'tg' } : block),
    ];
    const create = vi.fn().mockResolvedValue(undefined);
    const instance = await boot({ databasePages: true, create }, {}, nested);
    const before = await saved(instance);

    await step(instance, () => turnIntoPage(instance)?.onActivate?.());

    const after = await instance.save();

    expect(after.blocks.map(block => [block.type, block.parent ?? null])).toEqual([
      ['toggle', null], ['paragraph', 'tg'], ['page', 'tg'], ['paragraph', 'tg'],
    ]);
    // The page's database is top level there.
    expect(create.mock.calls[0][0].document.blocks[0].parent).toBeUndefined();

    await step(instance, () => instance.history.undo());
    expect(await saved(instance)).toBe(before);
  }, 30_000);

  it('uses the id the host gave the page', async () => {
    const create = vi.fn().mockResolvedValue({ pageId: 'host-1' });
    const instance = await boot({ databasePages: true, create });

    await step(instance, () => turnIntoPage(instance)?.onActivate?.());

    const after = await instance.save();

    expect(after.blocks[1].data).toEqual({ pageId: 'host-1', kind: 'database' });
  }, 30_000);

  it('changes nothing when the host fails to make the page', async () => {
    const create = vi.fn().mockRejectedValue(new Error('offline'));
    const instance = await boot({ databasePages: true, create });
    const before = await saved(instance);
    const couldUndo = instance.history.canUndo();

    await step(instance, () => turnIntoPage(instance)?.onActivate?.());

    expect(create).toHaveBeenCalledTimes(1);
    expect(await saved(instance)).toBe(before);
    expect(instance.history.canUndo()).toBe(couldUndo);
  }, 30_000);

  it('keeps the rows in the backend: they move, they are not deleted', async () => {
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
    const instance = await boot({ databasePages: true, create: vi.fn() }, { adapter });

    await step(instance, () => turnIntoPage(instance)?.onActivate?.());

    expect((await instance.save()).blocks.map(block => block.type)).toEqual(['paragraph', 'page', 'paragraph']);
    expect(adapter.deleteRow).not.toHaveBeenCalled();
  }, 30_000);

  it('is not offered unless the host opts into database pages', async () => {
    const instance = await boot({ create: vi.fn() });

    expect(turnIntoPage(instance)).toBeUndefined();
  }, 30_000);
});
