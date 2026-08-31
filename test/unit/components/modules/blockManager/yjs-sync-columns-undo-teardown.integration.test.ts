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
 * Integration: undoing a wrap-in-columns (drag-beside column creation) must
 * keep every promoted leaf block's holder ALIVE in the DOM.
 *
 * Y.UndoManager deletes a stack item's insertions in REVERSE insertion order,
 * so the observer emits the container removes CHILD-FIRST (column before
 * column_list). handleYjsRemove's child-promotion cascade walked survivors out
 * one level per remove assuming PARENT-FIRST order — under child-first order a
 * leaf lifted into the column_list's row container is no longer any surviving
 * block's model child, so removing the column_list destroyed its holder.
 * The model stayed correct (block back at root), only the DOM lost the block —
 * the exact e2e signature of columns.spec "undo of a drag-beside column
 * creation keeps the moved block in its original DOM slot".
 */
describe('BlockYjsSync — undo of a column wrap keeps promoted holders in the DOM (integration)', () => {
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

  const createStubBlock = (options: StubOptions, holder: HTMLElement): Block => {
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

  const makeLeafHolder = (): HTMLElement => {
    const holder = document.createElement('div');

    holder.setAttribute('data-blok-element', '');

    return holder;
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

  const wireSync = (rawBlocksStore: Blocks): void => {
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
  };

  it('after undo of a drag-beside wrap, every root block holder is connected and in order', async () => {
    // Doc state BEFORE the drop: eight root blocks.
    const rootIds = ['h1', 'i1', 'i2', 'i3', 'h2', 'o1'];

    store.fromJSON(rootIds.map((id) => ({ id, type: 'paragraph', data: {} })));

    // The wrap (drag h2 beside i2): all writes 'local', merged into ONE undo
    // stack item — mirrors wrapInNewColumnList under transactForTool.
    store.addBlock({ id: 'cl', type: 'column_list', data: {} }, 2);
    store.addBlock({ id: 'col1', type: 'column', data: {} }, 3);
    store.addBlock({ id: 'col2', type: 'column', data: {} }, 4);
    store.applyPlacement('col1', { parentId: 'cl', afterId: null }, 'local');
    store.applyPlacement('col2', { parentId: 'cl', afterId: 'col1' }, 'local');
    store.applyPlacement('i2', { parentId: 'col1', afterId: null }, 'local');
    store.applyPlacement('h2', { parentId: 'col2', afterId: null }, 'local');

    expect(store.toJSON().map((b) => b.id)).toEqual([
      'h1', 'i1', 'cl', 'col1', 'i2', 'col2', 'h2', 'i3', 'o1',
    ]);

    // In-memory + DOM mirror of the POST-drop state.
    const columnList = makeColumnListHolder();
    const column1 = makeColumnHolder();
    const column2 = makeColumnHolder();
    const leafHolders = new Map<string, HTMLElement>(
      rootIds.map((id) => [id, makeLeafHolder()])
    );

    // Root DOM order after the drop: h1, i1, [cl [col1 [i2]] [col2 [h2]]], i3, o1.
    for (const id of ['h1', 'i1']) {
      workingArea.appendChild(leafHolders.get(id) as HTMLElement);
    }
    workingArea.appendChild(columnList.holder);
    columnList.container.appendChild(column1.holder);
    columnList.container.appendChild(column2.holder);
    column1.childContainer.appendChild(leafHolders.get('i2') as HTMLElement);
    column2.childContainer.appendChild(leafHolders.get('h2') as HTMLElement);
    for (const id of ['i3', 'o1']) {
      workingArea.appendChild(leafHolders.get(id) as HTMLElement);
    }

    const rawBlocksStore = new Blocks(workingArea);

    const blockConfigs: StubOptions[] = [
      { id: 'h1' },
      { id: 'i1' },
      { id: 'cl', name: 'column_list', contentIds: ['col1', 'col2'] },
      { id: 'col1', name: 'column', parentId: 'cl', contentIds: ['i2'] },
      { id: 'i2', parentId: 'col1' },
      { id: 'col2', name: 'column', parentId: 'cl', contentIds: ['h2'] },
      { id: 'h2', parentId: 'col2' },
      { id: 'i3' },
      { id: 'o1' },
    ];

    const structuralHolders = new Map<string, HTMLElement>([
      ['cl', columnList.holder],
      ['col1', column1.holder],
      ['col2', column2.holder],
    ]);

    for (const config of blockConfigs) {
      const holder = structuralHolders.get(config.id) ?? leafHolders.get(config.id);

      if (holder === undefined) {
        throw new Error(`setup: no holder for ${config.id}`);
      }

      rawBlocksStore.push(createStubBlock(config, holder));
    }

    // Blocks.push flattens every holder to workingArea via insertToDOM —
    // rebuild the nested post-drop DOM the way mountChildBlocks leaves it.
    columnList.container.appendChild(column1.holder);
    columnList.container.appendChild(column2.holder);
    column1.childContainer.appendChild(leafHolders.get('i2') as HTMLElement);
    column2.childContainer.appendChild(leafHolders.get('h2') as HTMLElement);

    wireSync(rawBlocksStore);

    // ONE undo unwinds the whole wrap.
    undoManager.undo();
    await flushMicrotasks();

    // Model: containers gone, leaves back at root in original order.
    expect(store.toJSON().map((b) => b.id)).toEqual(rootIds);
    expect(repository.blocks.map((b) => b.id)).toEqual(rootIds);

    // Every promoted holder SURVIVES in the DOM (the regression destroyed
    // i2 and h2 with the doomed column_list subtree)...
    for (const id of rootIds) {
      const block = repository.getBlockById(id);

      expect(block, `block ${id} must exist`).toBeDefined();
      expect(
        (block as Block).holder.isConnected,
        `holder of ${id} must stay in the DOM after undo`
      ).toBe(true);
    }

    // ...at root level, in the original document order.
    const domOrder = Array.from(workingArea.children)
      .map((el) => repository.blocks.find((b) => b.holder === el)?.id)
      .filter((id): id is string => id !== undefined);

    expect(domOrder).toEqual(rootIds);
  });
});
