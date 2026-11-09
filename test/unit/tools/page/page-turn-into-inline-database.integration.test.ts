/**
 * "Turn into inline database" on a database page link (Notion:
 * research-live-notion.md §3, §4) brings the page's database, rows and row
 * bodies into this document in the link's place, as ONE undo step.
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

const PAGE_DOCUMENT: OutputData = {
  title: 'Tasks',
  blocks: [
    {
      id: 'db',
      type: 'database',
      data: {
        title: '',
        fullPage: true,
        schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
        views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
        activeViewId: 'v',
      },
      content: ['r1', 'r2'],
    },
    { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One' }, position: 'a0' }, content: ['b1'] },
    { id: 'b1', type: 'paragraph', parent: 'r1', data: { text: 'row body' } },
    { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Two' }, position: 'a1' } },
  ],
};

const BLOCKS: OutputBlockData[] = [
  { id: 'a', type: 'paragraph', data: { text: 'before' } },
  { id: 'link', type: 'page', data: { pageId: 'p1', kind: 'database' } },
  { id: 'z', type: 'paragraph', data: { text: 'after' } },
];

/** A database backend that records every write and never answers a load. */
const backend = () => ({
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
});

const boot = async (page: PageConfig, blocks: OutputBlockData[] = BLOCKS, database: Record<string, unknown> = {}): Promise<Runtime> => {
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

const turnIntoInline = (instance: Runtime): Item | undefined => {
  const block = instance.module.blockManager.blocks.find(candidate => candidate.id === 'link');

  return (block?.getTunes().toolTunes as Item[] | undefined)?.find(item => item.name === 'page-turn-into-inline-database');
};

describe('Turn into inline database on a database page link', () => {
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

  it('brings the database into this document and undoes as one step', async () => {
    const loadDocument = vi.fn().mockResolvedValue(structuredClone(PAGE_DOCUMENT));
    const instance = await boot({ databasePages: true, create: vi.fn(), loadDocument });
    const before = await saved(instance);
    const item = turnIntoInline(instance);

    expect(item?.title).toBe('Turn into inline database');

    await step(instance, () => item?.onActivate?.());

    expect(loadDocument).toHaveBeenCalledWith('p1');
    const after = await instance.save();

    expect(after.blocks.map(block => [block.id, block.parent ?? null])).toEqual([
      ['a', null], ['db', null], ['r1', 'db'], ['b1', 'r1'], ['r2', 'db'], ['z', null],
    ]);
    // An inline database shows its own title: the page title becomes it.
    expect(after.blocks[1].data.title).toBe('Tasks');
    expect(after.blocks[1].data).not.toHaveProperty('fullPage');

    await step(instance, () => instance.history.undo());
    expect(await saved(instance)).toBe(before);

    await step(instance, () => instance.history.redo());
    expect((await instance.save()).blocks.map(block => block.id)).toEqual(['a', 'db', 'r1', 'b1', 'r2', 'z']);
    expect(loadDocument).toHaveBeenCalledTimes(1);
  }, 30_000);

  it('puts the database inside the link\'s parent', async () => {
    const loadDocument = vi.fn().mockResolvedValue(structuredClone(PAGE_DOCUMENT));
    const instance = await boot({ databasePages: true, create: vi.fn(), loadDocument }, [
      { id: 'tg', type: 'toggle', data: { text: 'box' }, content: ['a', 'link', 'z'] },
      ...BLOCKS.map(block => ({ ...block, parent: 'tg' })),
    ]);
    const before = await saved(instance);

    await step(instance, () => turnIntoInline(instance)?.onActivate?.());

    expect((await instance.save()).blocks.map(block => [block.id, block.parent ?? null])).toEqual([
      ['tg', null], ['a', 'tg'], ['db', 'tg'], ['r1', 'db'], ['b1', 'r1'], ['r2', 'db'], ['z', 'tg'],
    ]);

    await step(instance, () => instance.history.undo());
    expect(await saved(instance)).toBe(before);
  }, 30_000);

  it('keeps the rows in the backend: no row is made twice or deleted, nor on undo', async () => {
    const adapter = backend();
    const loadDocument = vi.fn().mockResolvedValue(structuredClone(PAGE_DOCUMENT));
    const instance = await boot({ databasePages: true, create: vi.fn(), loadDocument }, BLOCKS, { adapter });

    await step(instance, () => turnIntoInline(instance)?.onActivate?.());
    await settle(600);
    expect((await instance.save()).blocks.map(block => block.id)).toEqual(['a', 'db', 'r1', 'b1', 'r2', 'z']);
    expect(adapter.createRow).not.toHaveBeenCalled();
    expect(adapter.deleteRow).not.toHaveBeenCalled();

    await step(instance, () => instance.history.undo());
    await step(instance, () => instance.history.redo());
    await settle(600);
    expect(adapter.createRow).not.toHaveBeenCalled();
    expect(adapter.deleteRow).not.toHaveBeenCalled();
  }, 30_000);

  it('changes nothing when the page has no document', async () => {
    const loadDocument = vi.fn().mockResolvedValue(null);
    const instance = await boot({ databasePages: true, create: vi.fn(), loadDocument });
    const before = await saved(instance);

    await step(instance, () => turnIntoInline(instance)?.onActivate?.());

    expect(loadDocument).toHaveBeenCalledTimes(1);
    expect(await saved(instance)).toBe(before);
  }, 30_000);

  it('is offered only on a database page link of a host with database pages and loadDocument', async () => {
    const plain = await boot({ databasePages: true, create: vi.fn(), loadDocument: vi.fn() }, [
      { id: 'link', type: 'page', data: { pageId: 'p1' } },
    ]);

    expect(turnIntoInline(plain)).toBeUndefined();
    plain.destroy();

    const noLoad = await boot({ databasePages: true, create: vi.fn() });

    expect(turnIntoInline(noLoad)).toBeUndefined();
  }, 30_000);
});
