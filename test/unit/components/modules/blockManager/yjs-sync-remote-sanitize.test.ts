import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';

import { YjsManager } from '../../../../../src/components/modules/yjs';
import { BlockYjsSync, type SyncHandlers, type BlockYjsSyncDependencies } from '../../../../../src/components/modules/blockManager/yjs-sync';
import { BlockRepository } from '../../../../../src/components/modules/blockManager/repository';
import { BlockFactory } from '../../../../../src/components/modules/blockManager/factory';
import { Blocks } from '../../../../../src/components/blocks';
import { ToolsCollection } from '../../../../../src/components/tools/collection';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { Block } from '../../../../../src/components/block';
import type { BlockToolAdapter } from '../../../../../src/components/tools/block';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { API } from '../../../../../src/components/modules/api';
import type { BlocksStore } from '../../../../../src/components/modules/blockManager/types';

/**
 * Remote-path tests drive the REAL Y.Doc: a transaction under an origin that
 * is not in LOCAL_ORIGIN_TAGS classifies as 'remote' in BlockObserver, which
 * is exactly how a provider-applied update arrives.
 */
const UNKNOWN_ORIGIN = 'test-provider';

/**
 * Per the inert-html-parse law, hostile strings are asserted on as DATA — the
 * test never parses them into a live or detached DOM.
 */
const IMG_ONERROR_PAYLOAD = '<img src="x" onerror="alert(1)">evil';
const JS_HREF_PAYLOAD = '<a href="javascript:alert(1)">link</a>';

const PARAGRAPH_SANITIZE = { text: { b: {}, a: { href: true } } };

const createMockBlock = (options: {
  id: string;
  name?: string;
  parentId?: string | null;
  contentIds?: string[];
} = { id: 'block' }): Block => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');

  const mockSetData = vi.fn((_data: Record<string, unknown>): Promise<boolean> => {
    return Promise.resolve(true);
  });

  return {
    id: options.id,
    holder,
    parentId: options.parentId ?? null,
    contentIds: options.contentIds ?? [],
    preservedTunes: {},
    setData: mockSetData as Block['setData'],
    call: vi.fn(),
    destroy: vi.fn(),
    name: options.name ?? 'paragraph',
    tool: {} as BlockToolAdapter,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    destroyEvents: vi.fn(),
  } as unknown as Block;
};

const setDataMock = (block: Block): ReturnType<typeof vi.fn> =>
  block.setData as unknown as ReturnType<typeof vi.fn>;

const createBlocksStore = (blocks: Block[]): BlocksStore => {
  const workingArea = document.createElement('div');
  const blocksStore = new Blocks(workingArea);

  for (const block of blocks) {
    blocksStore.push(block);
  }

  return new Proxy(blocksStore, {
    set: Blocks.set,
    get: Blocks.get,
  }) as unknown as BlocksStore;
};

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('BlockYjsSync — remote data sanitization and root promotion', () => {
  let manager: YjsManager;
  let repository: BlockRepository;
  let factory: BlockFactory;
  let handlers: SyncHandlers;
  let yjsSync: BlockYjsSync;
  let unsubscribe: (() => void) | null = null;

  const createHarness = (blocks: Block[]): void => {
    manager = new YjsManager({
      config: {},
      eventsDispatcher: {
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
      } as unknown as YjsManager['eventsDispatcher'],
    });

    const blocksStore = createBlocksStore(blocks);

    repository = new BlockRepository();
    repository.initialize(blocksStore);

    const tools = new ToolsCollection<BlockToolAdapter>();

    tools.set('paragraph', { sanitizeConfig: PARAGRAPH_SANITIZE } as unknown as BlockToolAdapter);
    tools.set('header', { sanitizeConfig: { text: { b: {} } } } as unknown as BlockToolAdapter);
    // No sanitizeConfig: pins the URL-scheme pass that runs regardless of per-tool config.
    tools.set('plain', {} as unknown as BlockToolAdapter);

    factory = new BlockFactory({
      API: {} as API,
      eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
      tools,
      moduleInstances: {
        ReadOnly: { isEnabled: false },
      } as never,
    }, vi.fn());

    handlers = {
      getBlockIndex: vi.fn((block: Block) => repository.getBlockIndex(block)),
      insertDefaultBlock: vi.fn(() => createMockBlock({ id: 'default' })),
      setBlockParent: vi.fn((block: Block, parentId: string | null) => {
        const target = block as { parentId: string | null };

        target.parentId = parentId;
      }),
      replaceBlock: vi.fn(),
      onBlockRemoved: vi.fn(),
      onBlockAdded: vi.fn(),
    };

    const dependencies: BlockYjsSyncDependencies = { YjsManager: manager };

    yjsSync = new BlockYjsSync(dependencies, repository, factory, handlers, blocksStore);
    unsubscribe = yjsSync.subscribe();
  };

  const getYDoc = (anyBlockId: string): Y.Doc => {
    const yblock = manager.getBlockById(anyBlockId);

    if (yblock === undefined || yblock.doc === null) {
      throw new Error(`No Y.Doc reachable via block "${anyBlockId}"`);
    }

    return yblock.doc;
  };

  const remoteTransact = (anyBlockId: string, fn: (doc: Y.Doc) => void): void => {
    const doc = getYDoc(anyBlockId);

    doc.transact(() => fn(doc), UNKNOWN_ORIGIN);
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (unsubscribe !== null) {
      unsubscribe();
      unsubscribe = null;
    }
    vi.restoreAllMocks();
  });

  describe('remote update path (handleYjsUpdate)', () => {
    it('strips executable markup from remote data before it reaches setData', async () => {
      const block = createMockBlock({ id: 'block-1' });

      createHarness([block]);
      manager.fromJSON([{ id: 'block-1', type: 'paragraph', data: { text: 'hello' } }]);

      remoteTransact('block-1', () => {
        const yblock = manager.getBlockById('block-1');
        const ydata = yblock?.get('data') as Y.Map<unknown>;

        ydata.set('text', IMG_ONERROR_PAYLOAD);
      });

      await flush();

      expect(setDataMock(block)).toHaveBeenCalledTimes(1);

      const [dataArg] = setDataMock(block).mock.calls[0] as [Record<string, unknown>];
      const text = String(dataArg.text);

      expect(text).not.toContain('onerror');
      expect(text).not.toContain('<img');
      expect(text).toContain('evil');
      // Data-only remote update on a root block must not touch hierarchy.
      expect(handlers.setBlockParent).not.toHaveBeenCalled();
    });

    it('strips javascript: URLs from remote data before it reaches setData', async () => {
      const block = createMockBlock({ id: 'block-1' });

      createHarness([block]);
      manager.fromJSON([{ id: 'block-1', type: 'paragraph', data: { text: 'hello' } }]);

      remoteTransact('block-1', () => {
        const yblock = manager.getBlockById('block-1');
        const ydata = yblock?.get('data') as Y.Map<unknown>;

        ydata.set('text', JS_HREF_PAYLOAD);
      });

      await flush();

      expect(setDataMock(block)).toHaveBeenCalledTimes(1);

      const [dataArg] = setDataMock(block).mock.calls[0] as [Record<string, unknown>];
      const text = String(dataArg.text);

      expect(text).not.toContain('javascript:');
      expect(text).toContain('link');
    });

    it('hands sanitized data to composeBlock when the remote type differs from the in-memory tool', async () => {
      const block = createMockBlock({ id: 'block-1' });

      createHarness([block]);
      // Poison via 'load' origin (never enters the sync path), then flip only
      // the type remotely — the compose branch reads the data off the doc.
      manager.fromJSON([{ id: 'block-1', type: 'paragraph', data: { text: IMG_ONERROR_PAYLOAD } }]);

      const replacement = createMockBlock({ id: 'block-1', name: 'header' });
      const composeSpy = vi.spyOn(factory, 'composeBlock').mockReturnValue(replacement);

      remoteTransact('block-1', () => {
        manager.getBlockById('block-1')?.set('type', 'header');
      });

      await flush();

      expect(composeSpy).toHaveBeenCalled();

      for (const call of composeSpy.mock.calls) {
        const options = call[0];
        const text = String((options.data as Record<string, unknown>).text);

        expect(options.tool).toBe('header');
        expect(text).not.toContain('onerror');
        expect(text).not.toContain('<img');
        expect(text).toContain('evil');
      }
    });

    it('hands sanitized data to the composeBlock fallback when setData resolves false', async () => {
      const block = createMockBlock({ id: 'block-1' });

      createHarness([block]);
      manager.fromJSON([{ id: 'block-1', type: 'paragraph', data: { text: 'hello' } }]);

      setDataMock(block).mockResolvedValue(false);

      const replacement = createMockBlock({ id: 'block-1' });
      const composeSpy = vi.spyOn(factory, 'composeBlock').mockReturnValue(replacement);

      remoteTransact('block-1', () => {
        const ydata = manager.getBlockById('block-1')?.get('data') as Y.Map<unknown>;

        ydata.set('text', IMG_ONERROR_PAYLOAD);
      });

      await flush();

      expect(setDataMock(block)).toHaveBeenCalledTimes(1);
      expect(composeSpy).toHaveBeenCalledTimes(1);

      const options = composeSpy.mock.calls[0][0];
      const text = String((options.data as Record<string, unknown>).text);

      expect(text).not.toContain('onerror');
      expect(text).not.toContain('<img');
      expect(text).toContain('evil');
    });

    it('strips javascript: URLs even when the tool declares no sanitizeConfig', async () => {
      const block = createMockBlock({ id: 'block-1', name: 'plain' });

      createHarness([block]);
      manager.fromJSON([{ id: 'block-1', type: 'plain', data: { text: 'hello' } }]);

      remoteTransact('block-1', () => {
        const ydata = manager.getBlockById('block-1')?.get('data') as Y.Map<unknown>;

        ydata.set('text', JS_HREF_PAYLOAD);
      });

      await flush();

      expect(setDataMock(block)).toHaveBeenCalledTimes(1);

      const [dataArg] = setDataMock(block).mock.calls[0] as [Record<string, unknown>];
      const text = String(dataArg.text);

      expect(text).not.toContain('javascript:');
      expect(text).toContain('link');
    });
  });

  describe('remote add path (handleYjsAdd)', () => {
    it('sanitizes remote block data before composeBlock', async () => {
      const existing = createMockBlock({ id: 'block-1' });

      createHarness([existing]);
      manager.fromJSON([{ id: 'block-1', type: 'paragraph', data: { text: 'hello' } }]);

      const added = createMockBlock({ id: 'evil-block' });
      const composeSpy = vi.spyOn(factory, 'composeBlock').mockReturnValue(added);

      remoteTransact('block-1', (doc) => {
        const yblocks = doc.getMap<Y.Map<unknown>>('blocks');
        const rootOrder = doc.getArray<string>('root');
        const ydata = new Y.Map<unknown>(Object.entries({ text: IMG_ONERROR_PAYLOAD }));
        const yblock = new Y.Map<unknown>(Object.entries({
          id: 'evil-block',
          type: 'paragraph',
          data: ydata,
        }));

        yblocks.set('evil-block', yblock);
        rootOrder.push(['evil-block']);
      });

      await flush();

      expect(composeSpy).toHaveBeenCalledTimes(1);

      const options = composeSpy.mock.calls[0][0];
      const text = String((options.data as Record<string, unknown>).text);

      expect(text).not.toContain('onerror');
      expect(text).not.toContain('<img');
      expect(text).toContain('evil');
    });
  });

  describe('remote batch-add path (handleYjsBatchAdd)', () => {
    it('sanitizes every remote block data before composeBlock', async () => {
      const existing = createMockBlock({ id: 'block-1' });

      createHarness([existing]);
      manager.fromJSON([{ id: 'block-1', type: 'paragraph', data: { text: 'hello' } }]);

      const composeSpy = vi.spyOn(factory, 'composeBlock').mockImplementation((options) =>
        createMockBlock({ id: options.id ?? 'unknown' }));

      remoteTransact('block-1', (doc) => {
        const yblocks = doc.getMap<Y.Map<unknown>>('blocks');
        const rootOrder = doc.getArray<string>('root');
        const makeBlock = (id: string, text: string): Y.Map<unknown> =>
          new Y.Map<unknown>(Object.entries({
            id,
            type: 'paragraph',
            data: new Y.Map<unknown>(Object.entries({ text })),
          }));

        yblocks.set('evil-1', makeBlock('evil-1', IMG_ONERROR_PAYLOAD));
        yblocks.set('evil-2', makeBlock('evil-2', JS_HREF_PAYLOAD));
        rootOrder.push(['evil-1', 'evil-2']);
      });

      await flush();

      expect(composeSpy).toHaveBeenCalledTimes(2);

      for (const call of composeSpy.mock.calls) {
        const text = String((call[0].data as Record<string, unknown>).text);

        expect(text).not.toContain('onerror');
        expect(text).not.toContain('<img');
        expect(text).not.toContain('javascript:');
      }
    });
  });

  describe('undo path is sanitized too (laundering guard)', () => {
    /**
     * A hostile peer's raw payload lives in the Y.Doc; a local undo restoring
     * that prior state replays it under the 'undo' origin. A remote-only gate
     * would skip the sanitize pass and hand the payload to setData → innerHTML.
     */
    it('delivers sanitized data to setData on undo', async () => {
      const block = createMockBlock({ id: 'block-1' });

      createHarness([block]);
      manager.fromJSON([{ id: 'block-1', type: 'paragraph', data: { text: IMG_ONERROR_PAYLOAD } }]);

      manager.updateBlockData('block-1', 'text', 'clean');
      manager.undo();

      await flush();

      expect(setDataMock(block)).toHaveBeenCalledTimes(1);

      const [dataArg] = setDataMock(block).mock.calls[0] as [Record<string, unknown>];
      const text = String(dataArg.text);

      expect(text).not.toContain('onerror');
      expect(text).not.toContain('<img');
      expect(text).toContain('evil');
    });
  });

  describe('remote root promotion (deleted parentId key)', () => {
    it('reparents the block to root when a remote transaction deletes parentId', async () => {
      const parent = createMockBlock({ id: 'parent-1', contentIds: ['child-1'] });
      const child = createMockBlock({ id: 'child-1', parentId: 'parent-1' });

      createHarness([parent, child]);
      manager.fromJSON([
        { id: 'parent-1', type: 'paragraph', data: { text: 'Parent' } },
        { id: 'child-1', type: 'paragraph', data: { text: 'Child' }, parent: 'parent-1' },
      ]);

      remoteTransact('child-1', () => {
        manager.getBlockById('child-1')?.delete('parentId');
      });

      await flush();

      expect(handlers.setBlockParent).toHaveBeenCalledWith(child, null);
      expect(child.parentId).toBeNull();
    });

    it('reparents to root on an undo-driven parentId deletion too', async () => {
      /**
       * This once deferred to UndoHistory's placement callback, which only
       * fires for DRAG moves (writes made inside a move group). A reparent
       * from the plain captured path — the blocks API, keyboard nesting, the
       * toolbox's insert-into-a-container — has no placement record, so its
       * undo left the block parented in memory while the doc said root.
       */
      const parent = createMockBlock({ id: 'parent-1' });
      const child = createMockBlock({ id: 'child-1' });

      createHarness([parent, child]);
      manager.fromJSON([
        { id: 'parent-1', type: 'paragraph', data: { text: 'Parent' } },
        { id: 'child-1', type: 'paragraph', data: { text: 'Child' } },
      ]);

      // Nest the child under a TRACKED local origin, mirroring it in memory,
      // so undo() deletes the parentId key under the UndoManager origin.
      manager.transact(() => {
        manager.getBlockById('child-1')?.set('parentId', 'parent-1');
      });
      (child as { parentId: string | null }).parentId = 'parent-1';

      manager.undo();

      await flush();

      expect(handlers.setBlockParent).toHaveBeenCalledWith(child, null);
    });

    it('stays a no-op when the placement callback already restored the parent', async () => {
      const parent = createMockBlock({ id: 'parent-1' });
      const child = createMockBlock({ id: 'child-1' });

      createHarness([parent, child]);
      manager.fromJSON([
        { id: 'parent-1', type: 'paragraph', data: { text: 'Parent' } },
        { id: 'child-1', type: 'paragraph', data: { text: 'Child' } },
      ]);

      manager.transact(() => {
        manager.getBlockById('child-1')?.set('parentId', 'parent-1');
      });

      // Memory already agrees with the doc's post-undo state, exactly as the
      // drag-move replay leaves it.
      manager.undo();

      await flush();

      expect(handlers.setBlockParent).not.toHaveBeenCalled();
    });
  });
});
