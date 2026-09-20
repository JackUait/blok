import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';

import type { BlokConfig } from '../../../../../types';
import { BlockChangedMutationType } from '../../../../../types/events/block/BlockChanged';
import type { Block } from '../../../../../src/components/block';
import { Blocks } from '../../../../../src/components/blocks';
import { BlockManager } from '../../../../../src/components/modules/blockManager/blockManager';
import { BlockRepository } from '../../../../../src/components/modules/blockManager/repository';
import { BlockYjsSync } from '../../../../../src/components/modules/blockManager/yjs-sync';
import type { SyncHandlers } from '../../../../../src/components/modules/blockManager/yjs-sync';
import type { BlockFactory } from '../../../../../src/components/modules/blockManager/factory';
import type { BlocksStore } from '../../../../../src/components/modules/blockManager/types';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

/**
 * Which blocks the deferred echo replay covers, and which writes it must not
 * make. `isReconciling` is SUBTREE-scoped — a container's window suppresses
 * its children too — so the replay has to be driven by "is this block still
 * inside any open window", not by the one id the window was opened with.
 */

interface Priv {
  yjsSync: BlockYjsSync;
  repository: BlockRepository;
  blockDidMutated: (mutationType: string, block: unknown, detail: Record<string, unknown>) => unknown;
  syncBlockDataToYjs: (block: Block) => Promise<void>;
  noteUserInput: (node: Node) => void;
}

interface Stub {
  id: string;
  holder: HTMLElement;
  save: ReturnType<typeof vi.fn>;
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

const drain = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

const makeStub = (id: string, parentId: string | null): Stub => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');

  return {
    id,
    name: 'paragraph',
    parentId,
    holder,
    contentIds: [],
    inputs: [],
    preservedData: {},
    preservedTunes: {},
    tool: { name: 'paragraph' },
    save: vi.fn(),
    setData: vi.fn(() => Promise.resolve(true)),
    call: vi.fn(),
    destroy: vi.fn(),
  } as unknown as Stub;
};

describe('the deferred echo replay — which blocks it covers', () => {
  let yjsManager: YjsManager;
  let blockManager: BlockManager;
  let priv: Priv;
  let parent: Stub;
  let child: Stub;

  beforeEach(() => {
    vi.clearAllMocks();

    const config: BlokConfig = { defaultBlock: 'paragraph', user: { id: 'user-1' } };
    const eventsDispatcher = new EventsDispatcher<BlokEventMap>();

    yjsManager = new YjsManager({ config, eventsDispatcher });
    blockManager = new BlockManager({ config, eventsDispatcher });
    blockManager.state = { YjsManager: yjsManager } as unknown as BlokModules;
    priv = blockManager as unknown as Priv;

    const workingArea = document.createElement('div');

    document.body.appendChild(workingArea);

    parent = makeStub('T', null);
    child = makeStub('C', 'T');
    parent.holder.appendChild(child.holder);

    const rawBlocksStore = new Blocks(workingArea);

    rawBlocksStore.push(parent as unknown as Block);
    rawBlocksStore.push(child as unknown as Block);

    const blocksStore = new Proxy(rawBlocksStore, { set: Blocks.set,
      get: Blocks.get }) as unknown as BlocksStore;
    const repository = new BlockRepository();

    repository.initialize(blocksStore);
    priv.repository = repository;

    priv.yjsSync = new BlockYjsSync(
      { YjsManager: yjsManager,
        isReadOnly: (): boolean => false },
      repository,
      {} as unknown as BlockFactory,
      { resyncBlockData: (block: Block): void => {
        void priv.syncBlockDataToYjs(block);
      } } as unknown as SyncHandlers,
      blocksStore
    );

    yjsManager.addBlock({ id: 'T', type: 'paragraph', data: { text: 'parent' } });
    yjsManager.addBlock({ id: 'C', type: 'paragraph', data: { text: 'seed' } });
    yjsManager.stopCapturing();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  const textOf = (id: string): unknown => {
    const data = yjsManager.getBlockById(id)?.get('data');

    return data instanceof Y.Map ? (data.toJSON() as Record<string, unknown>).text : undefined;
  };

  const typesInto = async (stub: Stub, text: string): Promise<void> => {
    stub.save.mockImplementation(async () => {
      await Promise.resolve();

      return { data: { text } };
    });
    priv.noteUserInput(stub.holder);
    priv.blockDidMutated(BlockChangedMutationType, stub, { index: 0 });
    await drain();
  };

  it('covers a child typed into while its CONTAINER holds the window', async () => {
    await priv.yjsSync.withAtomicOperationAsync(async () => {
      await Promise.resolve();
      await typesInto(child, 'seedX');
    }, { extendThroughRAF: true,
      blockId: 'T' });

    await nextFrame();
    await drain();

    expect(textOf('C')).toBe('seedX');
  });

  it('does not let one stranded keystroke make every later rewrite replay', async () => {
    // A keystroke in the child while the container reconciles.
    await priv.yjsSync.withAtomicOperationAsync(async () => {
      await Promise.resolve();
      await typesInto(child, 'seedX');
    }, { extendThroughRAF: true,
      blockId: 'T' });
    await nextFrame();
    await drain();

    // Later: a pure reconciler rewrite of that same child, no user input.
    child.save.mockImplementation(async () => {
      await Promise.resolve();

      return { data: { text: 'normalised by the tool' } };
    });
    await priv.yjsSync.withAtomicOperationAsync(async () => {
      await Promise.resolve();
      priv.blockDidMutated(BlockChangedMutationType, child, { index: 0 });
      await drain();
    }, { extendThroughRAF: true,
      blockId: 'C' });
    await nextFrame();
    await drain();

    expect(textOf('C')).not.toBe('normalised by the tool');
  });

  it('still lands the keystroke when a structural window outlives the block window', async () => {
    const releaseStructural = (priv.yjsSync as unknown as {
      beginAtomicOperation: (id?: string) => () => void;
    }).beginAtomicOperation(undefined);

    await priv.yjsSync.withAtomicOperationAsync(async () => {
      await Promise.resolve();
      await typesInto(parent, 'parentX');
    }, { extendThroughRAF: true,
      blockId: 'T' });
    await nextFrame();
    await drain();

    releaseStructural();
    await drain();

    expect(textOf('T')).toBe('parentX');
  });

  it('does not write a block mutated mid pointer-drag', async () => {
    blockManager.setPointerDragActive(true);

    await priv.yjsSync.withAtomicOperationAsync(async () => {
      await Promise.resolve();
      await typesInto(parent, 'dragged garbage');
    }, { extendThroughRAF: true,
      blockId: 'T' });
    await nextFrame();
    await drain();

    expect(textOf('T')).toBe('parent');
  });
});
