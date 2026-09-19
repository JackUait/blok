import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type * as Y from 'yjs';

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
 * A tag outside LOCAL_ORIGIN_TAGS classifies as 'remote' — how a provider
 * update arrives. 'move-redo' classifies as 'redo' without needing a live
 * UndoManager, which is what undo/redo replay looks like at this layer.
 */
const REMOTE_ORIGIN = 'test-provider';
const REDO_ORIGIN = 'move-redo';

const hosts: HTMLElement[] = [];

/**
 * A block whose setData rewrites the input's text and collapses the selection
 * onto the holder — what a real tool's innerHTML assignment does to the caret.
 */
const createRewritingBlock = (id: string): Block => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');

  const input = document.createElement('div');

  input.setAttribute('contenteditable', 'true');
  input.textContent = 'hello';
  holder.appendChild(input);
  document.body.appendChild(holder);
  hosts.push(holder);

  const setData = vi.fn((data: Record<string, unknown>): Promise<boolean> => {
    input.textContent = typeof data.text === 'string' ? data.text : '';

    // The browser drops the caret onto the surviving parent when the text
    // node it anchored into is replaced.
    const selection = document.getSelection();

    selection?.removeAllRanges();

    const collapsed = document.createRange();

    collapsed.setStart(holder, 0);
    collapsed.collapse(true);
    selection?.addRange(collapsed);

    return Promise.resolve(true);
  });

  return {
    id,
    holder,
    inputs: [input],
    parentId: null,
    contentIds: [],
    preservedTunes: {},
    setData: setData as unknown as Block['setData'],
    call: vi.fn(),
    destroy: vi.fn(),
    name: 'paragraph',
    tool: {} as BlockToolAdapter,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    destroyEvents: vi.fn(),
  } as unknown as Block;
};

const createBlocksStore = (blocks: Block[]): BlocksStore => {
  const workingArea = document.createElement('div');

  // Attached: the store moves each holder in here, and a Selection cannot be
  // placed inside a detached tree.
  document.body.appendChild(workingArea);
  hosts.push(workingArea);

  const blocksStore = new Blocks(workingArea);

  blocks.forEach((block) => blocksStore.push(block));

  return new Proxy(blocksStore, {
    set: Blocks.set,
    get: Blocks.get,
  }) as unknown as BlocksStore;
};

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('BlockYjsSync — caret preservation is for a peer, not for undo/redo', () => {
  let manager: YjsManager;
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
    const repository = new BlockRepository();

    repository.initialize(blocksStore);

    const tools = new ToolsCollection<BlockToolAdapter>();

    tools.set('paragraph', {} as unknown as BlockToolAdapter);

    const factory = new BlockFactory({
      API: {} as API,
      eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
      tools,
      moduleInstances: {
        ReadOnly: { isEnabled: false },
      } as never,
    }, vi.fn());

    const handlers: SyncHandlers = {
      getBlockIndex: vi.fn((block: Block) => repository.getBlockIndex(block)),
      insertDefaultBlock: vi.fn(),
      setBlockParent: vi.fn(),
      replaceBlock: vi.fn(),
      onBlockRemoved: vi.fn(),
      onBlockAdded: vi.fn(),
    };

    const dependencies: BlockYjsSyncDependencies = { YjsManager: manager };

    yjsSync = new BlockYjsSync(dependencies, repository, factory, handlers, blocksStore);
    unsubscribe = yjsSync.subscribe();
  };

  const transactAs = (blockId: string, origin: string, fn: () => void): void => {
    const yblock = manager.getBlockById(blockId);
    const doc = yblock?.doc as Y.Doc;

    doc.transact(fn, origin);
  };

  /** Put the caret at `offset` inside the block's only input. */
  const putCaret = (block: Block, offset: number): void => {
    const input = (block as unknown as { inputs: HTMLElement[] }).inputs[0];
    const textNode = input.firstChild as Text;
    const range = document.createRange();

    range.setStart(textNode, offset);
    range.collapse(true);

    const selection = document.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = null;
    hosts.splice(0).forEach((host) => host.remove());
    document.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
  });

  it('leaves the caret alone on a redo, so the undo history keeps the position it restored', async () => {
    const block = createRewritingBlock('block-1');

    createHarness([block]);
    manager.fromJSON([{ id: 'block-1', type: 'paragraph', data: { text: 'hello' } }]);

    putCaret(block, 5);

    transactAs('block-1', REDO_ORIGIN, () => {
      const ydata = manager.getBlockById('block-1')?.get('data') as Y.Map<unknown>;

      ydata.set('text', 'hello world');
    });

    await flush();

    const live = document.getSelection();

    // The caret must NOT have been pulled back into the input at offset 5:
    // undo history restores the redo's own caret, and this layer overwriting
    // it is what rewound the caret to the end of the pre-redo text.
    expect({ node: live?.anchorNode?.nodeName ?? null, offset: live?.anchorOffset ?? null })
      .toEqual({ node: 'DIV', offset: 0 });
  });

  it('still puts the caret back when a peer rewrote the block', async () => {
    const block = createRewritingBlock('block-2');

    createHarness([block]);
    manager.fromJSON([{ id: 'block-2', type: 'paragraph', data: { text: 'hello' } }]);

    putCaret(block, 5);

    transactAs('block-2', REMOTE_ORIGIN, () => {
      const ydata = manager.getBlockById('block-2')?.get('data') as Y.Map<unknown>;

      ydata.set('text', 'hello world');
    });

    await flush();

    const live = document.getSelection();

    expect({ node: live?.anchorNode?.nodeName ?? null, offset: live?.anchorOffset ?? null })
      .toEqual({ node: '#text', offset: 5 });
  });
});
