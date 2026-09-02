import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';

import type { BlokConfig } from '../../../../../types';
import { BlockChangedMutationType } from '../../../../../types/events/block/BlockChanged';
import type { Block } from '../../../../../src/components/block';
import { Blocks } from '../../../../../src/components/blocks';
import { BlockManager } from '../../../../../src/components/modules/blockManager/blockManager';
import { BlockYjsSync, type SyncHandlers } from '../../../../../src/components/modules/blockManager/yjs-sync';
import { BlockRepository } from '../../../../../src/components/modules/blockManager/repository';
import type { BlockFactory } from '../../../../../src/components/modules/blockManager/factory';
import type { BlocksStore } from '../../../../../src/components/modules/blockManager/types';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

/**
 * A peer's update to block A holds the reconciler's write-back suppression
 * through A's `setData` and one animation frame. The local user's own typing
 * in block B that lands inside that window must still reach the document —
 * the suppression exists to stop A's remote render echoing back, not to
 * drop B's keystrokes.
 *
 * Real YjsManager, real BlockYjsSync and the real BlockManager mutation path
 * (`blockDidMutated` → `syncBlockDataToYjs`); only the blocks are stubs.
 */

interface BlockManagerPrivate {
  blockDidMutated: (type: string, block: Block, detail: Record<string, unknown>) => Block;
  yjsSync: unknown;
}

const createStubBlock = (id: string, text: string): Block => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');

  return {
    id,
    name: 'paragraph',
    holder,
    parentId: null,
    contentIds: [],
    inputs: [],
    preservedData: { text },
    preservedTunes: {},
    tool: { name: 'paragraph' },
    save: vi.fn(() => Promise.resolve({ data: { text } })),
    setData: vi.fn(() => Promise.resolve(true)),
    call: vi.fn(),
    destroy: vi.fn(),
  } as unknown as Block;
};

const drainMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
};

describe('BlockYjsSync — local write-back while a peer update is being reconciled (integration)', () => {
  let manager: YjsManager;
  let peer: DocumentStore;
  let blockManager: BlockManager;
  let yjsSync: BlockYjsSync;
  let blockB: Block;
  let unsubscribe: (() => void) | null = null;
  let rafCallbacks: FrameRequestCallback[] = [];
  const originalRaf = globalThis.requestAnimationFrame;

  const readText = (id: string): unknown => {
    const data = manager.getBlockById(id)?.get('data');

    return data instanceof Y.Map ? data.get('text') : undefined;
  };

  const typeIntoB = (text: string): void => {
    (blockB.save as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { text } });
    (blockManager as unknown as BlockManagerPrivate).blockDidMutated(BlockChangedMutationType, blockB, { index: 1 });
  };

  const fireAnimationFrames = (): void => {
    const pending = rafCallbacks;

    rafCallbacks = [];
    pending.forEach((callback) => callback(0));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    rafCallbacks = [];
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      rafCallbacks.push(callback);

      return rafCallbacks.length;
    };

    const config: BlokConfig = { defaultBlock: 'paragraph', user: { id: 'local-user' } };
    const dispatcher = new EventsDispatcher<BlokEventMap>();

    manager = new YjsManager({
      config,
      eventsDispatcher: {
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
      } as unknown as YjsManager['eventsDispatcher'],
    });

    const workingArea = document.createElement('div');

    document.body.appendChild(workingArea);

    const rawBlocksStore = new Blocks(workingArea);
    const blockA = createStubBlock('A', 'a');

    blockB = createStubBlock('B', 'b');
    rawBlocksStore.push(blockA);
    rawBlocksStore.push(blockB);

    const blocksStore = new Proxy(rawBlocksStore, {
      set: Blocks.set,
      get: Blocks.get,
    }) as unknown as BlocksStore;
    const repository = new BlockRepository();

    repository.initialize(blocksStore);

    const factory = {
      composeBlock: vi.fn(),
      getTool: (): undefined => undefined,
      hasTool: (name: string): boolean => name === 'paragraph',
    } as unknown as BlockFactory;

    blockManager = new BlockManager({ config, eventsDispatcher: dispatcher });
    blockManager.state = {
      API: { methods: {} },
      YjsManager: manager,
    } as unknown as BlokModules;

    const handlers: SyncHandlers = {
      getBlockIndex: (block: Block): number => repository.getBlockIndex(block),
      insertDefaultBlock: vi.fn(() => createStubBlock('default', '')),
      setBlockParent: vi.fn(),
      replaceBlock: vi.fn(),
      onBlockRemoved: vi.fn(),
      onBlockAdded: vi.fn(),
    };

    yjsSync = new BlockYjsSync({ YjsManager: manager }, repository, factory, handlers, blocksStore);
    unsubscribe = yjsSync.subscribe();
    (blockManager as unknown as BlockManagerPrivate).yjsSync = yjsSync;

    manager.state = {
      BlockManager: {
        getBlockById: (id: string): Block | undefined => repository.getBlockById(id),
        getBlockByChildNode: (): undefined => undefined,
        currentBlock: undefined,
        reparentFromHistoryReplay: (): void => undefined,
      },
    } as unknown as BlokModules;

    manager.fromJSON([
      { id: 'A', type: 'paragraph', data: { text: 'a' } },
      { id: 'B', type: 'paragraph', data: { text: 'b' } },
    ]);

    peer = new DocumentStore(new YBlockSerializer());
    peer.applyRemoteUpdate(manager.encodeStateAsUpdate(peer.getStateVector()));
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = null;
    peer.destroy();
    manager.destroy();
    globalThis.requestAnimationFrame = originalRaf;
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('writes local typing to the document when nothing is being reconciled (control)', async () => {
    typeIntoB('b typed');
    await drainMicrotasks();

    expect(readText('B')).toBe('b typed');
  });

  it('writes local typing in B to the document while a peer update on A is being reconciled', async () => {
    peer.updateBlockData('A', 'text', 'peer typed');
    manager.applyRemoteUpdate(peer.encodeStateAsUpdate(manager.getStateVector()));

    expect(yjsSync.isSyncingFromYjs).toBe(true);
    expect(readText('A')).toBe('peer typed');

    typeIntoB('b typed');
    await drainMicrotasks();

    fireAnimationFrames();
    await drainMicrotasks();

    expect(yjsSync.isSyncingFromYjs).toBe(false);
    expect(readText('B')).toBe('b typed');
  });
});
