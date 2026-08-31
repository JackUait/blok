import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';

import { BlockYjsSync, type SyncHandlers } from '../../../../../src/components/modules/blockManager/yjs-sync';
import { BlockRepository } from '../../../../../src/components/modules/blockManager/repository';
import type { BlocksStore } from '../../../../../src/components/modules/blockManager/types';
import { Blocks } from '../../../../../src/components/blocks';
import type { Block } from '../../../../../src/components/block';
import type { BlockFactory } from '../../../../../src/components/modules/blockManager/factory';
import type { YjsManager } from '../../../../../src/components/modules/yjs';
import { BlockObserver } from '../../../../../src/components/modules/yjs/block-observer';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';

/**
 * Integration: a REMOTE contentIds-only reorder (no map add/remove, no
 * root-order change) must flow observer 'move' → BlockYjsSync →
 * syncBlockOrderFromYjs and physically reorder the local blocks. Before the
 * observer's order-array detection this change was invisible — the schema v1
 * move heuristic keyed on same-id add+remove pairs.
 *
 * Unlike yjs-sync.test.ts (fully mocked YjsManager), this harness wires
 * BlockYjsSync to a REAL DocumentStore + BlockObserver via the binary seam.
 */
describe('BlockYjsSync — remote contentIds-only reorder (integration)', () => {
  let store: DocumentStore;
  let serializer: YBlockSerializer;
  let observer: BlockObserver;
  let undoManager: Y.UndoManager;
  let repository: BlockRepository;
  let blocksStore: BlocksStore;
  let yjsSync: BlockYjsSync;
  let unsubscribe: () => void;

  const createStubBlock = (options: { id: string; parentId?: string | null }): Block => {
    const holder = document.createElement('div');

    holder.setAttribute('data-blok-element', '');

    return {
      id: options.id,
      holder,
      parentId: options.parentId ?? null,
      contentIds: [],
      name: 'paragraph',
      inputs: [],
      call: vi.fn(),
      setData: vi.fn(() => Promise.resolve(true)),
      destroy: vi.fn(),
    } as unknown as Block;
  };

  const flushMicrotasks = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }
  };

  beforeEach(() => {
    serializer = new YBlockSerializer();
    store = new DocumentStore(serializer);
    observer = new BlockObserver();
    undoManager = new Y.UndoManager(store.undoScope, {
      captureTimeout: 500,
      trackedOrigins: new Set(['local']),
    });
    observer.observe(
      { blocksMap: store.blocksMap, rootOrder: store.rootOrder },
      undoManager
    );

    store.fromJSON([
      { id: 'parent-1', type: 'paragraph', data: {}, content: ['c1', 'c2', 'c3'] },
      { id: 'c1', type: 'paragraph', data: {}, parent: 'parent-1' },
      { id: 'c2', type: 'paragraph', data: {}, parent: 'parent-1' },
      { id: 'c3', type: 'paragraph', data: {}, parent: 'parent-1' },
    ]);

    const workingArea = document.createElement('div');

    document.body.appendChild(workingArea);
    const rawBlocksStore = new Blocks(workingArea);

    for (const config of [
      { id: 'parent-1', parentId: null },
      { id: 'c1', parentId: 'parent-1' },
      { id: 'c2', parentId: 'parent-1' },
      { id: 'c3', parentId: 'parent-1' },
    ]) {
      rawBlocksStore.push(createStubBlock(config));
    }

    blocksStore = new Proxy(rawBlocksStore, {
      set: Blocks.set,
      get: Blocks.get,
    }) as unknown as BlocksStore;

    repository = new BlockRepository();
    repository.initialize(blocksStore);

    // Real observer + store stand in for the YjsManager facade surface
    // BlockYjsSync consumes.
    const yjsManagerFacade = {
      onBlocksChanged: observer.onBlocksChanged.bind(observer),
      toJSON: (): ReturnType<DocumentStore['toJSON']> => store.toJSON(),
      getBlockById: (id: string): Y.Map<unknown> | undefined => store.getBlockById(id),
      yMapToObject: (ymap: Y.Map<unknown>): Record<string, unknown> => serializer.yMapToObject(ymap),
    } as unknown as YjsManager;

    const handlers = {
      addToDom: vi.fn(),
      removeFromDom: vi.fn(),
      moveInDom: vi.fn(),
      getBlockIndex: (block: Block): number => repository.getBlockIndex(block),
      insertDefaultBlock: vi.fn(),
      updateIndentation: vi.fn(),
      setBlockParent: vi.fn(),
      replaceBlock: vi.fn(),
      onBlockRemoved: vi.fn(),
      onBlockAdded: vi.fn(),
    } as unknown as SyncHandlers;

    yjsSync = new BlockYjsSync(
      { YjsManager: yjsManagerFacade },
      repository,
      { getTool: vi.fn() } as unknown as BlockFactory,
      handlers,
      blocksStore
    );
    unsubscribe = yjsSync.subscribe();
  });

  afterEach(() => {
    unsubscribe();
    observer.destroy();
    undoManager.destroy();
    store.destroy();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('reorders local blocks to the remote order after a contentIds-only splice', async () => {
    // Remote peer reorders the children: c3 takes c1's slot.
    const mirror = new DocumentStore(new YBlockSerializer());

    mirror.applyRemoteUpdate(store.encodeStateAsUpdate());
    mirror.moveBlock('c3', mirror.findBlockIndex('c1'), 'local');

    // Only the parent's contentIds changed — no map keys, no root order.
    store.applyRemoteUpdate(mirror.encodeStateAsUpdate(store.getStateVector()));
    mirror.destroy();

    await flushMicrotasks();

    expect(store.toJSON().map((block) => block.id)).toEqual(['parent-1', 'c3', 'c1', 'c2']);
    expect(repository.blocks.map((block) => block.id)).toEqual(['parent-1', 'c3', 'c1', 'c2']);
  });

  it('classifies the reorder as a remote move for the touched id only', () => {
    const events: Array<{ type: string; blockId?: string; origin?: string }> = [];

    observer.onBlocksChanged((event) => {
      if ('blockId' in event) {
        events.push({ type: event.type, blockId: event.blockId, origin: event.origin });
      } else {
        events.push({ type: event.type });
      }
    });

    const mirror = new DocumentStore(new YBlockSerializer());

    mirror.applyRemoteUpdate(store.encodeStateAsUpdate());
    mirror.moveBlock('c2', mirror.findBlockIndex('c1'), 'local');
    store.applyRemoteUpdate(mirror.encodeStateAsUpdate(store.getStateVector()));
    mirror.destroy();

    expect(events).toEqual([{ type: 'move', blockId: 'c2', origin: 'remote' }]);
  });
});
