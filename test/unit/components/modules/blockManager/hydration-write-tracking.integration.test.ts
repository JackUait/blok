import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';

import type { BlokConfig } from '../../../../../types';
import { BlockAddedMutationType } from '../../../../../types/events/block/BlockAdded';
import { BlockRemovedMutationType } from '../../../../../types/events/block/BlockRemoved';
import { BlockChangedMutationType } from '../../../../../types/events/block/BlockChanged';
import type { Block } from '../../../../../src/components/block';
import { Blocks } from '../../../../../src/components/blocks';
import { BlockManager } from '../../../../../src/components/modules/blockManager/blockManager';
import { BlockYjsSync, type SyncHandlers } from '../../../../../src/components/modules/blockManager/yjs-sync';
import { BlockRepository } from '../../../../../src/components/modules/blockManager/repository';
import type { BlockFactory } from '../../../../../src/components/modules/blockManager/factory';
import type { BlocksStore, ComposeBlockOptions } from '../../../../../src/components/modules/blockManager/types';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import { modificationsObserverBatchTimeout } from '../../../../../src/components/constants';

/**
 * The editor's OWN hydration writes must not be undoable.
 *
 * A block materialised from the document runs its tool's normalisation
 * (`code-mermaid` stamping `lineNumbers`, a table rewriting legacy string rows)
 * AFTER the reconciler's per-block echo window has closed, so `blockDidMutated`
 * cannot tell it from a user edit and `flushBlockDataWrites` records it as a
 * tracked `'local'` transaction. One Ctrl+Z then replays the editor's own
 * materialisation against the document.
 *
 * Real YjsManager, real BlockYjsSync, real `BlockManager.blockDidMutated` →
 * `syncBlockDataToYjs`; only the blocks themselves are stubs.
 */

interface BlockManagerPrivate {
  blockDidMutated: (type: string, block: Block, detail: Record<string, unknown>) => Block;
  yjsSync: unknown;
}

const createStubBlock = (id: string, name = 'paragraph'): Block => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');

  return {
    id,
    name,
    holder,
    parentId: null,
    contentIds: [],
    inputs: [],
    preservedData: {},
    preservedTunes: {},
    tool: { name },
    save: vi.fn(() => Promise.resolve({ data: {} })),
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

describe('hydration write-back is not an undo entry (integration)', () => {
  let manager: YjsManager;
  let peer: DocumentStore;
  let blockManager: BlockManager;
  let yjsSync: BlockYjsSync;
  let repository: BlockRepository;
  let composed: Map<string, Block>;
  let unsubscribe: (() => void) | null = null;
  let rafCallbacks: FrameRequestCallback[] = [];
  let stopCapturingSpy: ReturnType<typeof vi.spyOn>;
  const originalRaf = globalThis.requestAnimationFrame;

  const readData = (id: string): Record<string, unknown> | undefined => {
    const data = manager.getBlockById(id)?.get('data');

    return data instanceof Y.Map ? data.toJSON() : undefined;
  };

  const fireAnimationFrames = (): void => {
    const pending = rafCallbacks;

    rafCallbacks = [];
    pending.forEach((callback) => callback(0));
  };

  /** One DOM-mutation write-back for `blockId`, carrying `data` as its save(). */
  const mutate = async (blockId: string, data: Record<string, unknown>): Promise<void> => {
    const block = composed.get(blockId) ?? repository.getBlockById(blockId);

    if (block === undefined) {
      throw new Error(`test setup: block ${blockId} was never materialised`);
    }

    (block.save as ReturnType<typeof vi.fn>).mockResolvedValue({ data });
    (blockManager as unknown as BlockManagerPrivate).blockDidMutated(BlockChangedMutationType, block, {
      index: repository.getBlockIndex(block),
    });

    await drainMicrotasks();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    rafCallbacks = [];
    composed = new Map<string, Block>();
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

    rawBlocksStore.push(createStubBlock('A'));

    const blocksStore = new Proxy(rawBlocksStore, {
      set: Blocks.set,
      get: Blocks.get,
    }) as unknown as BlocksStore;

    repository = new BlockRepository();
    repository.initialize(blocksStore);

    const factory = {
      composeBlock: vi.fn((options: ComposeBlockOptions): Block => {
        const block = createStubBlock(options.id ?? 'missing-id', options.tool);

        composed.set(block.id, block);

        return block;
      }),
      getTool: (): undefined => undefined,
      hasTool: (name: string): boolean => name === 'paragraph',
    } as unknown as BlockFactory;

    blockManager = new BlockManager({ config, eventsDispatcher: dispatcher });
    blockManager.state = {
      API: { methods: {} },
      YjsManager: manager,
    } as unknown as BlokModules;

    const priv = blockManager as unknown as BlockManagerPrivate;

    const handlers: SyncHandlers = {
      getBlockIndex: (block: Block): number => repository.getBlockIndex(block),
      insertDefaultBlock: vi.fn(() => createStubBlock('default')),
      setBlockParent: vi.fn(),
      replaceBlock: vi.fn(),
      onBlockRemoved: (block, index) => {
        priv.blockDidMutated(BlockRemovedMutationType, block, { index });
      },
      onBlockAdded: (block, index) => {
        priv.blockDidMutated(BlockAddedMutationType, block, { index });
      },
    };

    yjsSync = new BlockYjsSync({ YjsManager: manager }, repository, factory, handlers, blocksStore);
    unsubscribe = yjsSync.subscribe();
    priv.yjsSync = yjsSync;

    manager.state = {
      BlockManager: {
        getBlockById: (id: string): Block | undefined => repository.getBlockById(id),
        getBlockByChildNode: (): undefined => undefined,
        currentBlock: undefined,
        reparentFromHistoryReplay: (): void => undefined,
      },
    } as unknown as BlokModules;

    manager.fromJSON([{ id: 'A', type: 'paragraph', data: { text: 'a' } }]);

    peer = new DocumentStore(new YBlockSerializer());
    peer.applyRemoteUpdate(manager.encodeStateAsUpdate(peer.getStateVector()));

    stopCapturingSpy = vi.spyOn(manager, 'stopCapturing');
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = null;
    peer.destroy();
    manager.destroy();
    globalThis.requestAnimationFrame = originalRaf;
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * Materialise `C` through the remote add path and close the reconciler's
   * per-block echo window (its RAF), leaving the tool's normalisation to land
   * afterwards — exactly where the old guard could no longer see it.
   */
  const materializeRemoteBlock = async (): Promise<void> => {
    peer.addBlock({ id: 'C', type: 'paragraph', data: { text: 'x' } });
    manager.applyRemoteUpdate(peer.encodeStateAsUpdate(manager.getStateVector()));

    expect(repository.getBlockById('C')).toBeDefined();

    fireAnimationFrames();
    await drainMicrotasks();

    expect(yjsSync.isSyncingFromYjs).toBe(false);
  };

  it('leaves nothing undoable after a materialised block normalises its own data', async () => {
    await materializeRemoteBlock();

    // The tool's normalisation: it stamps a field the stored data never had.
    await mutate('C', { text: 'x', lineNumbers: true });

    expect(readData('C')).toEqual({ text: 'x', lineNumbers: true });
    expect(manager.canUndo()).toBe(false);
  });

  it('forces a boundary at settle so the user edit that follows is its own entry', async () => {
    await materializeRemoteBlock();

    stopCapturingSpy.mockClear();

    await mutate('C', { text: 'x', lineNumbers: true });

    // The user's first keystroke, well inside the 500ms capture window.
    await vi.advanceTimersByTimeAsync(50);
    await mutate('C', { text: 'x typed', lineNumbers: true });

    manager.undo();

    // One press reverts the user's word only — the normalisation stays put.
    expect(readData('C')).toEqual({ text: 'x', lineNumbers: true });

    // The seal that guarantees it: settling closes the capture group.
    expect(stopCapturingSpy).toHaveBeenCalled();
  });

  it('leaves nothing undoable when a whole batch materialises at once', async () => {
    // The collaborative LOAD path: one update carrying many blocks reaches the
    // observer as a single `batch-add`, not as N single adds.
    peer.addBlock({ id: 'D', type: 'paragraph', data: { text: 'd' } });
    peer.addBlock({ id: 'E', type: 'paragraph', data: { text: 'e' } });
    manager.applyRemoteUpdate(peer.encodeStateAsUpdate(manager.getStateVector()));

    expect(repository.getBlockById('D')).toBeDefined();
    expect(repository.getBlockById('E')).toBeDefined();

    fireAnimationFrames();
    await drainMicrotasks();

    await mutate('E', { text: 'e', lineNumbers: true });

    expect(readData('E')).toEqual({ text: 'e', lineNumbers: true });
    expect(manager.canUndo()).toBe(false);
  });

  it('closes the window on timeout when the tool normalises nothing', async () => {
    await materializeRemoteBlock();

    stopCapturingSpy.mockClear();

    const materialized = composed.get('C');

    if (materialized === undefined) {
      throw new Error('test setup: C was never materialised');
    }

    expect(yjsSync.isMaterializing(materialized)).toBe(true);

    await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout);

    expect(yjsSync.isMaterializing(materialized)).toBe(false);
    expect(stopCapturingSpy).toHaveBeenCalled();

    // The window is shut, so the user's own edit on that very block is a
    // normal, undoable one.
    await mutate('C', { text: 'x typed' });

    expect(manager.canUndo()).toBe(true);

    manager.undo();

    expect(readData('C')).toEqual({ text: 'x' });
  });

  it('does not open a settling window for a block an undo restored (guard)', async () => {
    // Undo/redo replays the user's OWN history, so a restored block is not the
    // editor materialising someone else's change. Opening a window there made
    // the first keystroke typed within 400ms of a Ctrl+Z untracked, and so
    // impossible to undo.
    manager.addBlock({ id: 'D', type: 'paragraph', data: { text: 'd' } });
    // Split the entries, or the add and the remove coalesce and undo nets to nothing.
    manager.stopCapturing();
    manager.removeBlock('D');

    // Local-origin events are filtered by subscribe(), so memory never held D:
    // the undo below therefore drives the real add path, not its early return.
    expect(repository.getBlockById('D')).toBeUndefined();

    manager.undo();

    fireAnimationFrames();
    await drainMicrotasks();

    const restored = repository.getBlockById('D');

    expect(restored).toBeDefined();
    expect(yjsSync.isMaterializing(restored as Block)).toBe(false);
  });

  it('keeps a genuine local edit tracked and undoable (guard)', async () => {
    // Nothing is materialising: this is an ordinary user edit on a block that
    // has been on screen all along.
    await mutate('A', { text: 'a typed' });

    expect(readData('A')).toEqual({ text: 'a typed' });
    expect(manager.canUndo()).toBe(true);

    manager.undo();

    expect(readData('A')).toEqual({ text: 'a' });
  });
});
