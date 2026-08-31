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
 * Integration: redo of a mid-column insert must restore the block at its
 * recorded position among the column's children — not at the end.
 *
 * The redo transaction re-adds the block map entry and re-splices the
 * parent's contentIds at the right slot in the DOC, but handleYjsAdd mirrors
 * the parent link into memory through setBlockParent, whose hierarchy-side
 * contentIds write APPENDS. The doc said "second child", memory said "last
 * child" — and save() reads memory. This is the e2e "the mid-column insert
 * order survives undo -> redo" regression at unit level.
 */
describe('BlockYjsSync — redo of a mid-column insert keeps child order (integration)', () => {
  let store: DocumentStore;
  let serializer: YBlockSerializer;
  let observer: BlockObserver;
  let undoManager: Y.UndoManager;
  let repository: BlockRepository;
  let blocksStore: BlocksStore;
  let yjsSync: BlockYjsSync;
  let unsubscribe: () => void;
  let workingArea: HTMLElement;

  interface StubOptions {
    id: string;
    name?: string;
    parentId?: string | null;
    contentIds?: string[];
  }

  const makeLeafHolder = (): HTMLElement => {
    const holder = document.createElement('div');

    holder.setAttribute('data-blok-element', '');

    return holder;
  };

  const createStubBlock = (options: StubOptions, holder: HTMLElement = makeLeafHolder()): Block => {
    return {
      id: options.id,
      holder,
      parentId: options.parentId ?? null,
      contentIds: options.contentIds ?? [],
      name: options.name ?? 'paragraph',
      inputs: [],
      preservedTunes: {},
      call: vi.fn(),
      setData: vi.fn(() => Promise.resolve(true)),
      destroy: vi.fn(),
    } as unknown as Block;
  };

  /** column_list holder: holder > content > row container [data-blok-columns]. */
  const makeColumnListHolder = (): { holder: HTMLElement; container: HTMLElement } => {
    const holder = document.createElement('div');

    holder.setAttribute('data-blok-element', '');
    const content = document.createElement('div');

    content.setAttribute('data-blok-element-content', '');
    holder.appendChild(content);
    const container = document.createElement('div');

    container.setAttribute('data-blok-columns', '');
    container.setAttribute('data-blok-nested-blocks', '');
    content.appendChild(container);

    return { holder, container };
  };

  /** column holder: holder > content > wrapper [data-blok-column] > child container. */
  const makeColumnHolder = (): { holder: HTMLElement; childContainer: HTMLElement } => {
    const holder = document.createElement('div');

    holder.setAttribute('data-blok-element', '');
    const content = document.createElement('div');

    content.setAttribute('data-blok-element-content', '');
    holder.appendChild(content);
    const wrapper = document.createElement('div');

    wrapper.setAttribute('data-blok-column', '');
    content.appendChild(wrapper);
    const childContainer = document.createElement('div');

    childContainer.setAttribute('data-blok-nested-blocks', '');
    wrapper.appendChild(childContainer);

    return { holder, childContainer };
  };

  const flushMicrotasks = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) {
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

    workingArea = document.createElement('div');
    document.body.appendChild(workingArea);
  });

  afterEach(() => {
    unsubscribe();
    observer.destroy();
    undoManager.destroy();
    store.destroy();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('redo restores the inserted block as the SECOND child, not the last', async () => {
    // Doc: a two-column layout; the left column c1 owns [h1, slot, body1, author1].
    store.fromJSON([
      { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
      { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['h1', 'slot', 'body1', 'author1'] },
      { id: 'h1', type: 'paragraph', data: {}, parent: 'c1' },
      { id: 'slot', type: 'paragraph', data: {}, parent: 'c1' },
      { id: 'body1', type: 'paragraph', data: {}, parent: 'c1' },
      { id: 'author1', type: 'paragraph', data: {}, parent: 'c1' },
      { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['h2'] },
      { id: 'h2', type: 'paragraph', data: {}, parent: 'c2' },
    ]);

    // In-memory + DOM mirror.
    const columnList = makeColumnListHolder();
    const column1 = makeColumnHolder();
    const column2 = makeColumnHolder();
    const leafHolders = new Map<string, HTMLElement>(
      ['h1', 'slot', 'body1', 'author1', 'h2'].map((id) => [id, makeLeafHolder()])
    );

    const rawBlocksStore = new Blocks(workingArea);
    const blockConfigs: StubOptions[] = [
      { id: 'cl1', name: 'column_list', contentIds: ['c1', 'c2'] },
      { id: 'c1', name: 'column', parentId: 'cl1', contentIds: ['h1', 'slot', 'body1', 'author1'] },
      { id: 'h1', parentId: 'c1' },
      { id: 'slot', parentId: 'c1' },
      { id: 'body1', parentId: 'c1' },
      { id: 'author1', parentId: 'c1' },
      { id: 'c2', name: 'column', parentId: 'cl1', contentIds: ['h2'] },
      { id: 'h2', parentId: 'c2' },
    ];

    const structuralHolders = new Map<string, HTMLElement>([
      ['cl1', columnList.holder],
      ['c1', column1.holder],
      ['c2', column2.holder],
    ]);

    for (const config of blockConfigs) {
      const holder = structuralHolders.get(config.id) ?? leafHolders.get(config.id);

      rawBlocksStore.push(createStubBlock(config, holder));
    }

    // Blocks.push flattens holders to workingArea — rebuild the nesting.
    columnList.container.appendChild(column1.holder);
    columnList.container.appendChild(column2.holder);
    for (const id of ['h1', 'slot', 'body1', 'author1']) {
      column1.childContainer.appendChild(leafHolders.get(id) as HTMLElement);
    }
    column2.childContainer.appendChild(leafHolders.get('h2') as HTMLElement);

    blocksStore = new Proxy(rawBlocksStore, {
      set: Blocks.set,
      get: Blocks.get,
    }) as unknown as BlocksStore;

    repository = new BlockRepository();
    repository.initialize(blocksStore);

    const yjsManagerFacade = {
      onBlocksChanged: observer.onBlocksChanged.bind(observer),
      toJSON: (): ReturnType<DocumentStore['toJSON']> => store.toJSON(),
      getBlockById: (id: string): Y.Map<unknown> | undefined => store.getBlockById(id),
      yMapToObject: (ymap: Y.Map<unknown>): Record<string, unknown> => serializer.yMapToObject(ymap),
    } as unknown as YjsManager;

    /**
     * Mirrors BlockHierarchy.setBlockParent's contentIds semantics: the new
     * parent's list is APPENDED to (hierarchy.ts pushes), which is exactly
     * what the replay path must correct against the doc's order.
     */
    const setBlockParentLikeHierarchy = (block: Block, parentId: string | null): void => {
      const reparented = block;
      const oldParent = reparented.parentId !== null ? repository.getBlockById(reparented.parentId) : undefined;

      if (oldParent !== undefined) {
        oldParent.contentIds = oldParent.contentIds.filter((id) => id !== reparented.id);
      }

      reparented.parentId = parentId;

      if (parentId === null) {
        return;
      }

      const newParent = repository.getBlockById(parentId);

      if (newParent === undefined) {
        return;
      }

      if (!newParent.contentIds.includes(block.id)) {
        newParent.contentIds = [...newParent.contentIds, block.id];
      }

      const container = newParent.holder.querySelector('[data-blok-toggle-children], [data-blok-nested-blocks]');

      if (container !== null && !container.contains(block.holder)) {
        container.appendChild(block.holder);
      }
    };

    const factory = {
      getTool: vi.fn(),
      hasTool: (): boolean => true,
      composeBlock: (options: { id: string; parentId?: string }): Block =>
        createStubBlock({ id: options.id, parentId: options.parentId ?? null }),
    } as unknown as BlockFactory;

    const handlers = {
      addToDom: vi.fn(),
      removeFromDom: vi.fn(),
      moveInDom: vi.fn(),
      getBlockIndex: (block: Block): number => repository.getBlockIndex(block),
      insertDefaultBlock: vi.fn(),
      updateIndentation: vi.fn(),
      setBlockParent: setBlockParentLikeHierarchy,
      replaceBlock: vi.fn(),
      onBlockRemoved: vi.fn(),
      onBlockAdded: vi.fn(),
    } as unknown as SyncHandlers;

    yjsSync = new BlockYjsSync(
      { YjsManager: yjsManagerFacade },
      repository,
      factory,
      handlers,
      blocksStore
    );
    unsubscribe = yjsSync.subscribe();

    // The mid-column toolbox insert: the empty 'slot' paragraph is replaced by
    // the image — one merged undo entry (remove + add within captureTimeout).
    const slotFlatIndex = store.findBlockIndex('slot');

    store.removeBlock('slot');
    store.addBlock({ id: 'img', type: 'paragraph', data: {}, parent: 'c1' }, slotFlatIndex);

    // Mirror the local operation in memory the way BlockManager does.
    const slotBlock = repository.getBlockById('slot') as Block;

    blocksStore.remove(repository.getBlockIndex(slotBlock));
    const imgBlock = createStubBlock({ id: 'img', parentId: 'c1' });

    blocksStore.insert(slotFlatIndex, imgBlock);
    const c1 = repository.getBlockById('c1') as Block;

    c1.contentIds = ['h1', 'img', 'body1', 'author1'];
    column1.childContainer.insertBefore(imgBlock.holder, leafHolders.get('body1') as HTMLElement);

    expect(store.toJSON().find((b) => b.id === 'c1')?.content).toEqual(['h1', 'img', 'body1', 'author1']);

    // Undo the insert, then redo it.
    undoManager.undo();
    await flushMicrotasks();
    undoManager.redo();
    await flushMicrotasks();

    // Doc: image back as the SECOND child.
    expect(store.toJSON().find((b) => b.id === 'c1')?.content).toEqual(['h1', 'img', 'body1', 'author1']);

    // Memory must agree — the regression left the image APPENDED (last).
    const c1After = repository.getBlockById('c1') as Block;

    expect(c1After.contentIds).toEqual(['h1', 'img', 'body1', 'author1']);

    // The restored holder sits between the heading and the body in the DOM.
    const imgAfter = repository.getBlockById('img') as Block;
    const domOrder = Array.from(column1.childContainer.children)
      .map((el) => repository.blocks.find((b) => b.holder === el)?.id)
      .filter((id): id is string => id !== undefined);

    expect(imgAfter.holder.isConnected).toBe(true);
    expect(domOrder).toEqual(['h1', 'img', 'body1', 'author1']);
  });
});
