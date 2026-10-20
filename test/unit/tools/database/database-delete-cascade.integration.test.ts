import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import { destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Bookmark } from '../../../../src/tools/link/bookmark';
import { Column, ColumnList, TabsTool, TabTool, Toggle } from '../../../../src/tools';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { DatabaseCommentTool } from '../../../../src/tools/database-comment';
import type { DatabaseAdapter, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';
import { encode } from '../../../../src/components/modules/collaboration/sync-wire';
import type { SyncWireFrame } from '../../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
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

const table = (id: string, extra: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id, name: 'Table', type: 'table', position: 'a0', filters: [], sorts: [], visibleProperties: [], ...extra,
});

const schema: PropertyDefinition[] = [{ id: 't', name: 'Name', type: 'title', position: 'a0' }];

/** p0, a database `db` (row r1 with a body, a comment, a second source `src-b` with row b1), p1. */
const doc = (): OutputBlockData[] => [
  { id: 'p0', type: 'paragraph', data: { text: 'Before' } },
  {
    id: 'db', type: 'database', content: ['r1', 'src-b', 'c1'],
    data: {
      title: 'Projects', schema,
      views: [table('v1'), table('vb', { position: 'a1', dataSourceId: 'src-b' })],
      activeViewId: 'v1',
    },
  },
  { id: 'r1', type: 'database-row', parent: 'db', content: ['body1'], data: { properties: { t: 'Parent row' }, position: 'a0', bodyBlocks: true } },
  { id: 'body1', type: 'paragraph', parent: 'r1', data: { text: 'body text' } },
  {
    id: 'src-b', type: 'database', parent: 'db', content: ['b1'],
    data: { title: 'Src B', schema, views: [table('bv')], activeViewId: 'bv' },
  },
  { id: 'b1', type: 'database-row', parent: 'src-b', data: { properties: { t: 'Source row' }, position: 'a0' } },
  { id: 'c1', type: 'database-comment', parent: 'db', data: { rowId: 'r1', text: 'hi', author: 'a', createdAt: 1 } },
  { id: 'p1', type: 'paragraph', data: { text: 'After' } },
];

/** Every row write each database's backend got, as `database:call:row`. */
let backendCalls: string[] = [];

/** A backend per database that logs row writes. */
const spyAdapter = (databaseId: string, blocks: OutputBlockData[] = doc()): DatabaseAdapter => {
  const fixture = blocks.find((saved) => saved.id === databaseId);
  const { schema: savedSchema, views } = (fixture?.data ?? {}) as { schema: PropertyDefinition[]; views: DatabaseViewConfig[] };
  const log = (call: string, rowId: string): void => void backendCalls.push(`${databaseId}:${call}:${rowId}`);

  return {
    loadDatabase: async () => structuredClone({ schema: savedSchema, views }),
    createRow: async (params) => { log('createRow', params.id); return { ...params }; },
    updateRow: async ({ rowId, properties }) => ({ id: rowId, properties, position: 'a0' }),
    moveRow: async ({ rowId, position }) => ({ id: rowId, properties: {}, position }),
    deleteRow: async ({ rowId }) => { log('deleteRow', rowId); },
    createProperty: async (params) => ({ ...params }),
    updateProperty: async ({ propertyId }) => ({ id: propertyId, name: '', type: 'text', position: 'a0' }),
    deleteProperty: async () => undefined,
    createView: async (params) => ({ sorts: [], filters: [], visibleProperties: [], ...params }),
    updateView: async ({ viewId }) => table(viewId),
    deleteView: async () => undefined,
  };
};

/** With a backend per database id; any other database has none. */
let backends: Record<string, DatabaseAdapter> = {};

class BackedDatabase extends DatabaseTool {
  constructor(options: ConstructorParameters<typeof DatabaseTool>[0]) {
    const adapter = backends[options.block.id] ?? backends['*'];

    super({ ...options, config: adapter === undefined ? options.config : { ...options.config, adapter } });
  }
}

const boot = async (blocks: OutputBlockData[], live = false): Promise<Core> => {
  holder = document.createElement('div');
  document.body.appendChild(holder);
  const instance = new Core({
    holder, tabSync: false, dataModel: 'hierarchical', i18n: { locale: 'en' },
    ...(live ? { server: 'https://sync.test/api/', collaboration: { doc: 'database-delete-peer' } } : {}),
    tools: {
      paragraph: Paragraph, bookmark: Bookmark, toggle: Toggle, column_list: ColumnList, column: Column, tabs: TabsTool, tab: TabTool,
      database: BackedDatabase, 'database-row': DatabaseRowTool, 'database-comment': DatabaseCommentTool,
    },
    ...(live ? {} : { data: { blocks } }),
  });

  core = instance;
  await instance.isReady;
  await quiet();

  return instance;
};

const hasMarkDestroyed = (value: unknown): value is { markDestroyed(): void } =>
  typeof value === 'object' && value !== null && 'markDestroyed' in value && typeof value.markDestroyed === 'function';
const hasDestroy = (value: unknown): value is { destroy(): void | Promise<void> } =>
  typeof value === 'object' && value !== null && 'destroy' in value && typeof value.destroy === 'function';

const destroyCore = async (instance: Core): Promise<void> => {
  const modules: unknown[] = Object.values(instance.moduleInstances);

  modules.filter(hasMarkDestroyed).forEach((module) => module.markDestroyed());
  await Promise.all(modules.filter(hasDestroy).map((module) => module.destroy()));
};

const block = (instance: Core, id: string): NonNullable<ReturnType<Core['moduleInstances']['BlockManager']['getBlockById']>> => {
  const found = instance.moduleInstances.BlockManager.getBlockById(id);

  if (found === undefined) throw new Error(`missing block ${id}`);

  return found;
};

/** `id<parent` for every saved block, in saved order. */
const savedShape = async (instance: Core): Promise<string[]> =>
  ((await instance.moduleInstances.Saver.save())?.blocks ?? []).map((saved) => `${saved.id ?? '?'}<${saved.parent ?? 'root'}`);

/** `id<parent` for every block in the Yjs document. */
const yjsShape = (instance: Core): string[] =>
  instance.moduleInstances.YjsManager.toJSON().map((saved) => `${saved.id ?? '?'}<${saved.parent ?? 'root'}`);

/** `id<parent` for every live block in the editor's flat list. */
const liveShape = (instance: Core): string[] =>
  instance.moduleInstances.BlockManager.blocks.map((live) => `${live.id}<${live.parentId ?? 'root'}`);

/** Every block id still holding a DOM holder in the editor. */
const holderIds = (): string[] =>
  [...(holder?.querySelectorAll<HTMLElement>('[data-blok-element][data-blok-id]') ?? [])].map((el) => el.getAttribute('data-blok-id') ?? '');

const original = (): string[] => doc().map((saved) => `${saved.id ?? '?'}<${saved.parent ?? 'root'}`);

const deleteViaApi = async (instance: Core, id: string): Promise<void> => {
  const { blocks } = instance.moduleInstances.API.methods;
  const index = blocks.getBlockIndex(id);

  if (index === undefined) throw new Error(`no index for ${id}`);
  await blocks.delete(index);
  await quiet();
};

const undo = async (instance: Core): Promise<void> => {
  instance.moduleInstances.API.methods.history.undo();
  await quiet();
};

const redo = async (instance: Core): Promise<void> => {
  instance.moduleInstances.API.methods.history.redo();
  await quiet();
};

describe('deleting a database deletes its rows, sources and comments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (core !== undefined) await destroyCore(core);
    core = undefined;
    holder?.remove();
    holder = undefined;
    destroyTooltip();
    PopoverRegistry.resetForTests();
    backends = {};
    backendCalls = [];
    vi.restoreAllMocks();
  });

  it('a second data source takes its rows with it, and leaves the holder\'s own rows', async () => {
    const instance = await boot(doc());

    await deleteViaApi(instance, 'src-b');

    const expected = original().filter((entry) => !entry.startsWith('src-b') && !entry.startsWith('b1'));

    expect(await savedShape(instance)).toEqual(expected);
    expect(yjsShape(instance)).toEqual(expected);
    expect(liveShape(instance)).toEqual(expected);
    expect(holderIds()).not.toContain('b1');
    expect(block(instance, 'db').holder.textContent).not.toContain('Source row');
  });

  it('a root database takes its rows, row bodies, sources and comments with it', async () => {
    const instance = await boot(doc());

    await deleteViaApi(instance, 'db');

    expect(await savedShape(instance)).toEqual(['p0<root', 'p1<root']);
    expect(yjsShape(instance)).toEqual(['p0<root', 'p1<root']);
    expect(holderIds()).toEqual(['p0', 'p1']);
  });

  it('one undo brings back the source and its rows; redo deletes them again', async () => {
    const instance = await boot(doc());

    await deleteViaApi(instance, 'src-b');
    await undo(instance);

    expect(await savedShape(instance)).toEqual(original());

    await redo(instance);

    expect((await savedShape(instance)).filter((entry) => entry.startsWith('b1') || entry.startsWith('src-b'))).toEqual([]);
  });

  it('one undo brings back a root database with everything under it; redo deletes it all again', async () => {
    const instance = await boot(doc());

    await deleteViaApi(instance, 'db');
    await undo(instance);

    expect(await savedShape(instance)).toEqual(original());
    expect(yjsShape(instance)).toEqual(original());

    await redo(instance);

    expect(await savedShape(instance)).toEqual(['p0<root', 'p1<root']);
  });

  it('Backspace on a selected database deletes its subtree, and the blocks around it stay', async () => {
    const instance = await boot(doc());
    const { BlockSelection, BlockEvents } = instance.moduleInstances;

    BlockSelection.selectBlock(block(instance, 'db'));
    BlockEvents.keydown(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    await quiet();

    expect(await savedShape(instance)).toEqual(['p0<root', 'p1<root']);
    expect(yjsShape(instance)).toEqual(['p0<root', 'p1<root']);

    await undo(instance);

    expect(await savedShape(instance)).toEqual(original());
  });

  it('deleting a selection that spans a database and the blocks around it leaves no orphan', async () => {
    const instance = await boot([...doc(), { id: 'p2', type: 'paragraph', data: { text: 'Last' } }]);
    const { BlockSelection, BlockManager } = instance.moduleInstances;

    BlockSelection.selectBlock(block(instance, 'p0'));
    BlockSelection.selectBlock(block(instance, 'db'));
    BlockSelection.selectBlock(block(instance, 'p1'));
    BlockManager.deleteSelectedBlocksAndInsertReplacement();
    await quiet();

    expect(await savedShape(instance)).toEqual(['p2<root']);
    expect(yjsShape(instance)).toEqual(['p2<root']);
  });

  it('cutting a selected database removes its subtree from the document', async () => {
    const instance = await boot(doc());
    const { BlockSelection, BlockEvents } = instance.moduleInstances;
    const written = new Map<string, string>();

    BlockSelection.selectBlock(block(instance, 'db'));
    BlockEvents.handleCommandX({
      preventDefault: () => undefined,
      clipboardData: { setData: (type: string, value: string): void => void written.set(type, value) },
    } as unknown as ClipboardEvent);
    await quiet();

    expect(written.size).toBeGreaterThan(0);

    expect(await savedShape(instance)).toEqual(['p0<root', 'p1<root']);
    expect(yjsShape(instance)).toEqual(['p0<root', 'p1<root']);
  });

  it('undo of a database insert removes its rows too', async () => {
    const instance = await boot([{ id: 'p0', type: 'paragraph', data: { text: 'Before' } }]);
    const { blocks } = instance.moduleInstances.API.methods;

    instance.moduleInstances.YjsManager.stopCapturing();
    blocks.transact?.(() => {
      blocks.insert('database', { title: 'New', schema, views: [table('nv')], activeViewId: 'nv' }, undefined, 1, false, false, 'ndb');
      blocks.insertAt('database-row', { properties: { t: 'New row' }, position: 'a0' }, { parentId: 'ndb', position: 'end', id: 'nr' });
    });
    await quiet();

    expect(await savedShape(instance)).toEqual(['p0<root', 'ndb<root', 'nr<ndb']);

    await undo(instance);

    expect(await savedShape(instance)).toEqual(['p0<root']);
    expect(yjsShape(instance)).toEqual(['p0<root']);
  });

  it('a database nested in a row\'s page body takes its own rows with it', async () => {
    const instance = await boot([
      ...doc().filter((saved) => saved.id !== 'body1').map((saved) => saved.id === 'r1' ? { ...saved, content: ['inner'] } : saved),
      { id: 'inner', type: 'database', parent: 'r1', content: ['x1'], data: { title: 'Inner', schema, views: [table('iv')], activeViewId: 'iv' } },
      { id: 'x1', type: 'database-row', parent: 'inner', data: { properties: { t: 'Inner row' }, position: 'a0' } },
    ]);

    await deleteViaApi(instance, 'inner');

    const shape = await savedShape(instance);

    expect(shape.filter((entry) => entry.startsWith('x1') || entry.startsWith('inner'))).toEqual([]);
    expect(shape).toContain('r1<db');
    expect(block(instance, 'r1').contentIds).toEqual([]);
  });

  it('a toggle that holds a database hands the database up whole, rows still under it', async () => {
    const instance = await boot([
      { id: 'tg', type: 'toggle', data: { text: 'toggle', isOpen: true }, content: ['db'] },
      ...doc().filter((saved) => saved.id !== 'p0' && saved.id !== 'p1').map((saved) => saved.id === 'db' ? { ...saved, parent: 'tg' } : saved),
    ]);

    await deleteViaApi(instance, 'tg');

    const expected = original().filter((entry) => entry !== 'p0<root' && entry !== 'p1<root');

    expect(await savedShape(instance)).toEqual(expected);
    expect(yjsShape(instance)).toEqual(expected);
  });

  it('a column that holds a database takes the database and its rows with it', async () => {
    const dbBlocks = doc().filter((saved) => saved.id !== 'p0' && saved.id !== 'p1');
    const instance = await boot([
      { id: 'cl', type: 'column_list', data: {}, content: ['k1', 'k2'] },
      { id: 'k1', type: 'column', data: {}, parent: 'cl', content: ['db'] },
      ...dbBlocks.map((saved) => saved.id === 'db' ? { ...saved, parent: 'k1' } : saved),
      { id: 'k2', type: 'column', data: {}, parent: 'cl', content: ['side'] },
      { id: 'side', type: 'paragraph', data: { text: 'side' }, parent: 'k2' },
      { id: 'tail', type: 'paragraph', data: { text: 'tail' } },
    ]);

    await deleteViaApi(instance, 'cl');

    expect(await savedShape(instance)).toEqual(['tail<root']);
    expect(yjsShape(instance)).toEqual(['tail<root']);
  });

  it('deleting a database leaves another database its view points at untouched', async () => {
    const instance = await boot([
      { id: 'other', type: 'database', content: ['o1'], data: { title: 'Other', schema, views: [table('ov')], activeViewId: 'ov' } },
      { id: 'o1', type: 'database-row', parent: 'other', data: { properties: { t: 'Other row' }, position: 'a0' } },
      {
        id: 'holder', type: 'database', content: ['h1'],
        data: { title: 'Holder', schema, views: [table('hv'), table('hv2', { position: 'a1', dataSourceId: 'other' })], activeViewId: 'hv2' },
      },
      { id: 'h1', type: 'database-row', parent: 'holder', data: { properties: { t: 'Holder row' }, position: 'a0' } },
    ]);

    await deleteViaApi(instance, 'holder');

    expect(await savedShape(instance)).toEqual(['other<root', 'o1<other']);
  });

  it('Backspace on a selection of every block leaves one empty paragraph', async () => {
    const instance = await boot(doc());
    const { BlockSelection, BlockEvents } = instance.moduleInstances;

    ['p0', 'db', 'p1'].forEach((id) => BlockSelection.selectBlock(block(instance, id)));
    BlockEvents.keydown(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    await quiet();

    expect(instance.moduleInstances.BlockManager.blocks.map((live) => live.name)).toEqual(['paragraph']);
    expect(instance.moduleInstances.YjsManager.toJSON().map((entry) => entry.type)).toEqual(['paragraph']);
    expect(holderIds()).toHaveLength(1);
  });

  it('Backspace on a selection of every block around a tabs block leaves one empty paragraph', async () => {
    const instance = await boot([
      { id: 'p0', type: 'paragraph', data: { text: 'Before' } },
      { id: 'tabs', type: 'tabs', data: {}, content: ['t1'] },
      { id: 't1', type: 'tab', data: { title: 'Alpha' }, parent: 'tabs', content: ['tp'] },
      { id: 'tp', type: 'paragraph', data: { text: 'one' }, parent: 't1' },
      { id: 'p1', type: 'paragraph', data: { text: 'After' } },
    ]);
    const { BlockSelection, BlockEvents } = instance.moduleInstances;

    ['p0', 'tabs', 'p1'].forEach((id) => BlockSelection.selectBlock(block(instance, id)));
    BlockEvents.keydown(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    await quiet();

    expect(instance.moduleInstances.BlockManager.blocks.map((live) => live.name)).toEqual(['paragraph']);
    expect(instance.moduleInstances.YjsManager.toJSON().map((entry) => entry.type)).toEqual(['paragraph']);
  });

  it('cutting a selection of every block leaves one empty paragraph', async () => {
    const instance = await boot(doc());
    const { BlockSelection, BlockEvents } = instance.moduleInstances;

    ['p0', 'db', 'p1'].forEach((id) => BlockSelection.selectBlock(block(instance, id)));
    BlockEvents.handleCommandX({
      preventDefault: () => undefined,
      clipboardData: { setData: (): void => undefined },
    } as unknown as ClipboardEvent);
    await quiet();

    expect(instance.moduleInstances.BlockManager.blocks.map((live) => live.name)).toEqual(['paragraph']);
    expect(instance.moduleInstances.YjsManager.toJSON().map((entry) => entry.type)).toEqual(['paragraph']);
    expect(holderIds()).toHaveLength(1);
  });

  it('deleting the only database in a document leaves one empty paragraph', async () => {
    const instance = await boot(doc().filter((saved) => saved.id !== 'p0' && saved.id !== 'p1'));

    await deleteViaApi(instance, 'db');

    expect(instance.moduleInstances.BlockManager.blocks.map((live) => live.name)).toEqual(['paragraph']);
    expect(instance.moduleInstances.YjsManager.toJSON().map((entry) => entry.type)).toEqual(['paragraph']);
  });

  const replaceWithParagraph = async (instance: Core, id: string): Promise<void> => {
    const { blocks } = instance.moduleInstances.API.methods;
    const index = blocks.getBlockIndex(id);

    if (index === undefined) throw new Error(`no index for ${id}`);
    instance.moduleInstances.YjsManager.stopCapturing();
    blocks.insert('paragraph', { text: 'Instead' }, undefined, index, false, true, 'np');
    await quiet();
  };

  it('replacing a database with another block leaves none of its rows behind', async () => {
    const instance = await boot(doc());

    await replaceWithParagraph(instance, 'db');

    expect(await savedShape(instance)).toEqual(['p0<root', 'np<root', 'p1<root']);
    expect(yjsShape(instance)).toEqual(['p0<root', 'np<root', 'p1<root']);
    expect(liveShape(instance)).toEqual(['p0<root', 'np<root', 'p1<root']);
    expect(holderIds()).toEqual(['p0', 'np', 'p1']);
  });

  it('one undo of a database replace brings the database back with everything under it', async () => {
    const instance = await boot(doc());

    await replaceWithParagraph(instance, 'db');
    await undo(instance);

    expect(await savedShape(instance)).toEqual(original());
    expect(yjsShape(instance)).toEqual(original());
  });

  it('replacing a row takes its page body with it', async () => {
    const instance = await boot(doc());

    await replaceWithParagraph(instance, 'r1');

    const shape = await savedShape(instance);

    expect(shape.filter((entry) => entry.startsWith('body1') || entry.startsWith('r1'))).toEqual([]);
    expect(yjsShape(instance).filter((entry) => entry.startsWith('body1'))).toEqual([]);
  });

  it('replacing a tabs block keeps its tabs, under the new block (v1.16.1 behaviour)', async () => {
    const instance = await boot([
      { id: 'p0', type: 'paragraph', data: { text: 'Before' } },
      { id: 'tabs', type: 'tabs', data: {}, content: ['t1'] },
      { id: 't1', type: 'tab', data: { title: 'Alpha' }, parent: 'tabs', content: ['tp'] },
      { id: 'tp', type: 'paragraph', data: { text: 'one' }, parent: 't1' },
      { id: 'p1', type: 'paragraph', data: { text: 'After' } },
    ]);

    await replaceWithParagraph(instance, 'tabs');

    expect(await savedShape(instance)).toEqual(['p0<root', 'np<root', 't1<np', 'tp<t1', 'p1<root']);
    expect(yjsShape(instance)).toEqual(['p0<root', 'np<root', 't1<np', 'tp<t1', 'p1<root']);
  });

  it('replacing a toggle still keeps its children, under the new block', async () => {
    const instance = await boot([
      { id: 'tg', type: 'toggle', data: { text: 'toggle', isOpen: true }, content: ['inside'] },
      { id: 'inside', type: 'paragraph', data: { text: 'inside' }, parent: 'tg' },
    ]);

    await replaceWithParagraph(instance, 'tg');

    expect(await savedShape(instance)).toEqual(['np<root', 'inside<np']);
    expect(yjsShape(instance)).toEqual(['np<root', 'inside<np']);
  });

  describe('a local delete tells the backend', () => {
    const backed = async (blocks: OutputBlockData[] = doc()): Promise<Core> => {
      backends = Object.fromEntries(blocks.filter((saved) => saved.type === 'database').map((saved) => [saved.id ?? '', spyAdapter(saved.id ?? '', blocks)]));
      const instance = await boot(blocks);

      backendCalls = [];

      return instance;
    };
    const deletes = (): string[] => backendCalls.filter((call) => call.includes(':deleteRow:')).sort();
    const creates = (): string[] => backendCalls.filter((call) => call.includes(':createRow:')).sort();

    it('deleting one row block deletes that row', async () => {
      const instance = await backed();

      await deleteViaApi(instance, 'r1');

      expect(backendCalls).toEqual(['db:deleteRow:r1']);
    });

    it('undo of a row delete creates the row again; redo deletes it again', async () => {
      const instance = await backed();

      await deleteViaApi(instance, 'r1');
      backendCalls = [];
      await undo(instance);

      expect(creates()).toEqual(['db:createRow:r1']);
      expect(deletes()).toEqual([]);

      backendCalls = [];
      await redo(instance);

      expect(deletes()).toEqual(['db:deleteRow:r1']);
      expect(creates()).toEqual([]);
    });

    it('deleting a database deletes its rows and its source\'s rows, each in its own backend', async () => {
      const instance = await backed();

      await deleteViaApi(instance, 'db');

      expect(deletes()).toEqual(['db:deleteRow:r1', 'src-b:deleteRow:b1']);
      expect(creates()).toEqual([]);
    });

    it('undo of a database delete creates every row again; redo deletes them again', async () => {
      const instance = await backed();

      await deleteViaApi(instance, 'db');
      backendCalls = [];
      await undo(instance);

      expect(creates()).toEqual(['db:createRow:r1', 'src-b:createRow:b1']);
      expect(deletes()).toEqual([]);

      backendCalls = [];
      await redo(instance);

      expect(deletes()).toEqual(['db:deleteRow:r1', 'src-b:deleteRow:b1']);
      expect(creates()).toEqual([]);
    });

    it('Backspace on a selected database deletes its rows', async () => {
      const instance = await backed();
      const { BlockSelection, BlockEvents } = instance.moduleInstances;

      BlockSelection.selectBlock(block(instance, 'db'));
      BlockEvents.keydown(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
      await quiet();

      expect(deletes()).toEqual(['db:deleteRow:r1', 'src-b:deleteRow:b1']);
    });

    it('deleting a selection that spans a database deletes its rows', async () => {
      const instance = await backed();
      const { BlockSelection, BlockManager } = instance.moduleInstances;

      ['p0', 'db', 'p1'].forEach((id) => BlockSelection.selectBlock(block(instance, id)));
      BlockManager.deleteSelectedBlocksAndInsertReplacement();
      await quiet();

      expect(deletes()).toEqual(['db:deleteRow:r1', 'src-b:deleteRow:b1']);
    });

    it('cutting a selected database deletes its rows', async () => {
      const instance = await backed();
      const { BlockSelection, BlockEvents } = instance.moduleInstances;

      BlockSelection.selectBlock(block(instance, 'db'));
      BlockEvents.handleCommandX({
        preventDefault: () => undefined,
        clipboardData: { setData: (): void => undefined },
      } as unknown as ClipboardEvent);
      await quiet();

      expect(deletes()).toEqual(['db:deleteRow:r1', 'src-b:deleteRow:b1']);
    });

    it('undo creates a deleted row again even when it carries page keys the backend does not store', async () => {
      const instance = await backed(doc().map((saved) => saved.id === 'r1'
        ? { ...saved, data: { ...saved.data, icon: 'x', pageId: 'page-1', cover: 'https://example.test/c.png' } }
        : saved));

      await deleteViaApi(instance, 'r1');
      backendCalls = [];
      await undo(instance);

      expect(creates()).toEqual(['db:createRow:r1']);
    });

    /** One adapter for every database, as a host configures it; it never answers loadDatabase. */
    const sharedBackend = (): Set<string> => {
      const held = new Set(doc().filter((saved) => saved.type === 'database-row').map((saved) => saved.id ?? ''));
      const adapter = spyAdapter('db');

      backends = {
        '*': {
          ...adapter,
          loadDatabase: () => new Promise(() => undefined),
          createRow: async (params) => { held.add(params.id); return adapter.createRow(params); },
          deleteRow: async (params) => { held.delete(params.rowId); return adapter.deleteRow(params); },
        },
      };

      return held;
    };
    const savedRows = async (instance: Core): Promise<string[]> =>
      ((await instance.moduleInstances.Saver.save())?.blocks ?? []).filter((saved) => saved.type === 'database-row').map((saved) => saved.id ?? '').sort();

    it('cutting a database and pasting it back leaves its pasted rows in the backend', async () => {
      const held = sharedBackend();
      const instance = await boot(doc());
      const { BlockSelection, BlockEvents, Paste, BlockManager, Caret } = instance.moduleInstances;
      const written = new Map<string, string>();

      BlockSelection.selectBlock(block(instance, 'db'));
      BlockEvents.handleCommandX({
        preventDefault: () => undefined,
        clipboardData: { setData: (type: string, value: string): void => void written.set(type, value) },
      } as unknown as ClipboardEvent);
      await quiet();
      BlockManager.setCurrentBlockByChildNode(block(instance, 'p1').holder);
      Caret.setToBlock(block(instance, 'p1'), Caret.positions.END);
      await Paste.processDataTransfer({
        types: [...written.keys()], getData: (type: string) => written.get(type) ?? '', files: [] as unknown as FileList, items: [],
      } as unknown as DataTransfer);
      await quiet();
      await quiet();

      const pasted = await savedRows(instance);

      expect(pasted).toHaveLength(2);
      expect([...held].sort()).toEqual(pasted);
    });

    it('duplicating a database creates its copied rows in the backend', async () => {
      const held = sharedBackend();
      const instance = await boot(doc());
      const before = new Set(held);

      await instance.moduleInstances.DragManager.duplicateBlocksInPlace(block(instance, 'db'));
      await quiet();
      await quiet();

      const copies = (await savedRows(instance)).filter((id) => !before.has(id));

      expect(copies).toHaveLength(2);
      expect([...held].filter((id) => !before.has(id)).sort()).toEqual(copies);
      expect(creates().length).toBe(2);
    });

    it('deleting a source deletes only its own rows', async () => {
      const instance = await backed();

      await deleteViaApi(instance, 'src-b');

      expect(backendCalls).toEqual(['src-b:deleteRow:b1']);
    });

    it('undo of a source delete creates its rows again; redo deletes them again', async () => {
      const instance = await backed();

      await deleteViaApi(instance, 'src-b');
      backendCalls = [];
      await undo(instance);

      expect(creates()).toEqual(['src-b:createRow:b1']);
      expect(deletes()).toEqual([]);

      backendCalls = [];
      await redo(instance);

      expect(deletes()).toEqual(['src-b:deleteRow:b1']);
    });

    it('replacing a database deletes its rows', async () => {
      const instance = await backed();
      const { blocks } = instance.moduleInstances.API.methods;
      const index = blocks.getBlockIndex('db');

      if (index === undefined) throw new Error('no index for db');
      blocks.insert('paragraph', { text: 'Instead' }, undefined, index, false, true, 'np');
      await quiet();

      expect(deletes()).toEqual(['db:deleteRow:r1', 'src-b:deleteRow:b1']);
    });

    it('a database whose view shows another database deletes none of that one\'s rows', async () => {
      const instance = await backed([
        { id: 'other', type: 'database', content: ['o1'], data: { title: 'Other', schema, views: [table('ov')], activeViewId: 'ov' } },
        { id: 'o1', type: 'database-row', parent: 'other', data: { properties: { t: 'Other row' }, position: 'a0' } },
        {
          id: 'holder', type: 'database', content: ['h1'],
          data: { title: 'Holder', schema, views: [table('hv'), table('hv2', { position: 'a1', dataSourceId: 'other' })], activeViewId: 'hv2' },
        },
        { id: 'h1', type: 'database-row', parent: 'holder', data: { properties: { t: 'Holder row' }, position: 'a0' } },
      ]);

      await deleteViaApi(instance, 'holder');

      expect(backendCalls).toEqual(['holder:deleteRow:h1']);
    });

    it('destroying the editor deletes nothing', async () => {
      const instance = await backed();

      await destroyCore(instance);
      core = undefined;
      await quiet();

      expect(backendCalls).toEqual([]);
    });

    it('clearing or rendering the editor deletes nothing', async () => {
      const instance = await backed();
      const { blocks } = instance.moduleInstances.API.methods;

      await blocks.render({ blocks: [{ id: 'fresh', type: 'paragraph', data: { text: 'fresh' } }] });
      await quiet();
      await blocks.render({ blocks: doc() });
      await quiet();
      await blocks.clear();
      await quiet();

      expect(deletes()).toEqual([]);
    });
  });

  describe('a peer deletes a database', () => {
    class PeerSocket {
      static last: PeerSocket | undefined;
      binaryType = 'blob';
      readyState = 0;
      protocol = '';
      onopen: ((event: unknown) => void) | null = null;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onclose: ((event: { code: number; reason: string }) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;

      constructor() {
        PeerSocket.last = this;
      }

      send(): void {}

      close(): void {
        this.readyState = 3;
      }

      open(): void {
        this.protocol = 'blok-sync.v1';
        this.readyState = 1;
        this.onopen?.({});
      }

      deliver(frame: SyncWireFrame): void {
        this.onmessage?.({ data: encode(frame) });
      }
    }

    let peer: DocumentStore;
    let originalSocket: PropertyDescriptor | undefined;

    beforeEach(() => {
      peer = new DocumentStore(new YBlockSerializer());
      originalSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
      Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: PeerSocket });
    });

    afterEach(() => {
      peer.destroy();
      if (originalSocket === undefined) Reflect.deleteProperty(globalThis, 'WebSocket');
      else Object.defineProperty(globalThis, 'WebSocket', originalSocket);
    });

    const bootWithPeer = async (): Promise<{ instance: Core; send: () => void }> => {
      peer.fromJSON(doc().map((saved) => ({ ...saved, id: saved.id ?? '' })));
      const instance = await boot([], true);
      const socket = PeerSocket.last;

      if (socket === undefined) throw new Error('collaboration opened no socket');
      socket.open();
      socket.deliver({ type: 'control', tag: { format: 2, epoch: 0, lineage: '0123456789abcdef0123456789abcdef' } });
      socket.deliver({ type: 'syncStep2', update: peer.encodeStateAsUpdate() });
      await vi.waitFor(() => {
        expect(liveShape(instance)).toEqual(original());
        expect(instance.moduleInstances.ReadOnly.isEnabled).toBe(false);
      });
      await quiet();

      return { instance, send: () => socket.deliver({ type: 'update', update: peer.encodeStateAsUpdate() }) };
    };

    it('a peer that removes the database and its rows sends nothing to the backend here', async () => {
      backends = { db: spyAdapter('db'), 'src-b': spyAdapter('src-b') };
      const { instance, send } = await bootWithPeer();

      backendCalls = [];
      ['c1', 'b1', 'src-b', 'body1', 'r1', 'db'].forEach((id) => peer.removeBlock(id));
      send();
      await quiet();

      await vi.waitFor(() => expect(liveShape(instance)).toEqual(['p0<root', 'p1<root']));
      await quiet();
      expect(backendCalls.filter((call) => call.includes(':deleteRow:'))).toEqual([]);
    });

    it('a peer that removes the source and its rows leaves no orphan here', async () => {
      const { instance, send } = await bootWithPeer();

      peer.removeBlock('b1');
      peer.removeBlock('src-b');
      send();
      await quiet();

      const expected = original().filter((entry) => !entry.startsWith('src-b') && !entry.startsWith('b1'));

      await vi.waitFor(() => expect(liveShape(instance)).toEqual(expected));
      expect(await savedShape(instance)).toEqual(expected);
      expect(holderIds()).not.toContain('b1');
    });

    // Only a client from before deletesChildren on database writes this: its rows stay in Yjs under a dead parent.
    it.fails('a peer that removes only the source block still takes its rows out here', async () => {
      const { instance, send } = await bootWithPeer();

      peer.removeBlock('src-b');
      send();
      await quiet();

      const expected = original().filter((entry) => !entry.startsWith('src-b') && !entry.startsWith('b1'));

      await vi.waitFor(() => expect(liveShape(instance)).toEqual(expected));
      expect(await savedShape(instance)).toEqual(expected);
    });
  });
});
