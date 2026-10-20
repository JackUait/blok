import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import { destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Bookmark } from '../../../../src/tools/link/bookmark';
import { Column, ColumnList, Toggle } from '../../../../src/tools';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { DatabaseCommentTool } from '../../../../src/tools/database-comment';
import type { DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';
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

const boot = async (blocks: OutputBlockData[], live = false): Promise<Core> => {
  holder = document.createElement('div');
  document.body.appendChild(holder);
  const instance = new Core({
    holder, tabSync: false, dataModel: 'hierarchical', i18n: { locale: 'en' },
    ...(live ? { server: 'https://sync.test/api/', collaboration: { doc: 'database-delete-peer' } } : {}),
    tools: {
      paragraph: Paragraph, bookmark: Bookmark, toggle: Toggle, column_list: ColumnList, column: Column,
      database: DatabaseTool, 'database-row': DatabaseRowTool, 'database-comment': DatabaseCommentTool,
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

  // Open: insert-replace re-homes a replaced container's children (block-insertion reparentChildrenTo) and ignores deletesChildren.
  it.fails('replacing a database with another block leaves none of its rows behind', async () => {
    const instance = await boot(doc());
    const { blocks } = instance.moduleInstances.API.methods;
    const index = blocks.getBlockIndex('db');

    if (index === undefined) throw new Error('no index for db');
    blocks.insert('paragraph', { text: 'Instead' }, undefined, index, false, true, 'np');
    await quiet();

    expect(await savedShape(instance)).toEqual(['p0<root', 'np<root', 'p1<root']);
    expect(yjsShape(instance)).toEqual(['p0<root', 'np<root', 'p1<root']);
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
