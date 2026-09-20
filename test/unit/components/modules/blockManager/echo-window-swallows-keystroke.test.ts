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
 * A peer's edit is applied by rewriting the block's DOM, and the write-back is
 * suppressed for the whole window so the rewrite does not echo into the
 * document. The window runs through `setData`'s await AND one animation frame,
 * which is long enough for the user to type into it — and that keystroke was
 * dropped with the echo, then erased from the DOM by the next peer rewrite.
 */

interface BlockManagerPrivateAccess {
  yjsSync: BlockYjsSync;
  noteUserInput: (node: Node) => void;
  repository: BlockRepository;
  blockDidMutated: (mutationType: string, block: unknown, detail: Record<string, unknown>) => unknown;
  syncBlockDataToYjs: (block: Block) => Promise<void>;
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

const drainMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

describe('a keystroke typed while a peer rewrite holds the echo window open', () => {
  let yjsManager: YjsManager;
  let priv: BlockManagerPrivateAccess;
  let stub: { id: string; holder: HTMLElement; save: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();

    const config: BlokConfig = { defaultBlock: 'paragraph', user: { id: 'user-1' } };
    const eventsDispatcher = new EventsDispatcher<BlokEventMap>();

    yjsManager = new YjsManager({ config, eventsDispatcher });

    const blockManager = new BlockManager({ config, eventsDispatcher });

    blockManager.state = { YjsManager: yjsManager } as unknown as BlokModules;
    priv = blockManager as unknown as BlockManagerPrivateAccess;

    const workingArea = document.createElement('div');

    document.body.appendChild(workingArea);

    const holder = document.createElement('div');

    holder.setAttribute('data-blok-element', '');

    stub = {
      id: 'p1',
      name: 'paragraph',
      parentId: null,
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
    } as unknown as { id: string; holder: HTMLElement; save: ReturnType<typeof vi.fn> };

    const rawBlocksStore = new Blocks(workingArea);

    rawBlocksStore.push(stub as unknown as Block);

    const blocksStore = new Proxy(rawBlocksStore, {
      set: Blocks.set,
      get: Blocks.get,
    }) as unknown as BlocksStore;

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

    yjsManager.addBlock({ id: 'p1', type: 'paragraph', data: { text: 'seed' } });
    yjsManager.stopCapturing();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  const readText = (): unknown => {
    const data = yjsManager.getBlockById('p1')?.get('data');

    return data instanceof Y.Map ? (data.toJSON() as Record<string, unknown>).text : undefined;
  };

  it('still reaches the document once the window closes', async () => {
    stub.save.mockImplementation(async () => {
      await Promise.resolve();

      return { data: { text: 'seedX' } };
    });

    // The peer's rewrite holds the window open through its await and one frame.
    await priv.yjsSync.withAtomicOperationAsync(async () => {
      await Promise.resolve();
      // The user types while the rewrite is still in flight.
      priv.noteUserInput(stub.holder);
      priv.blockDidMutated(BlockChangedMutationType, stub, { index: 0 });
      await drainMicrotasks();
    }, { extendThroughRAF: true,
      blockId: 'p1' });

    await nextFrame();
    await drainMicrotasks();

    expect(readText()).toBe('seedX');
  });

  it('leaves the reconciler\'s own rewrite alone, so a convert stays one undo step', async () => {
    stub.save.mockImplementation(async () => {
      await Promise.resolve();

      return { data: { text: 'normalised by the tool' } };
    });

    // Same window, but no user input: this mutation is the rewrite's own echo.
    await priv.yjsSync.withAtomicOperationAsync(async () => {
      await Promise.resolve();
      priv.blockDidMutated(BlockChangedMutationType, stub, { index: 0 });
      await drainMicrotasks();
    }, { extendThroughRAF: true,
      blockId: 'p1' });

    await nextFrame();
    await drainMicrotasks();

    expect(readText()).toBe('seed');
  });
});
