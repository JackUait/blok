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
 * LOCAL EDIT -> save() -> Yjs write, while a peer is editing the same document.
 *
 * The reconcile window drops every write-back as the reconciler's own echo and
 * only replays the drop for a block that saw a `beforeinput`
 * (`BlockYjsSync.noteSuppressedMutation`). A paste and an inline-tool edit
 * produce no `beforeinput`:
 *   - Paste: `src/components/modules/paste/index.ts:623` calls
 *     `event.preventDefault()` on the clipboard event and inserts itself, so
 *     the browser never runs the default action that would fire one.
 *   - Inline tools: `BoldInlineTool.toggleBold`
 *     (`src/components/inline-tools/inline-tool-bold.ts:167`) rewrites the DOM
 *     through `toggleMark`, not through an input command.
 *
 * Real YjsManager, real BlockYjsSync, real BlockManager mutation path and a
 * real second Y.Doc as the peer. Only the blocks are stubs — driving a real
 * keystroke through jsdom does not reach the save pipeline.
 */

interface BlockManagerPrivate {
  blockDidMutated: (type: string, block: Block, detail: Record<string, unknown>) => Block;
  yjsSync: unknown;
}

const createStubBlock = (id: string, text: string): Block => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');

  const input = document.createElement('div');

  input.setAttribute('contenteditable', 'true');
  holder.appendChild(input);

  return {
    id,
    name: 'paragraph',
    holder,
    parentId: null,
    contentIds: [],
    inputs: [input],
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
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};

describe('concurrent save pipeline — what a peer edit makes the local pipeline drop', () => {
  let manager: YjsManager;
  let peer: DocumentStore;
  let blockManager: BlockManager;
  let yjsSync: BlockYjsSync;
  let blockA: Block;
  let blockB: Block;
  let repository: BlockRepository;
  let unsubscribe: (() => void) | null = null;
  let rafCallbacks: FrameRequestCallback[] = [];
  const originalRaf = globalThis.requestAnimationFrame;

  const readText = (id: string): unknown => {
    const data = manager.getBlockById(id)?.get('data');

    if (!(data instanceof Y.Map)) {
      return undefined;
    }

    const text = data.get('text');

    return text instanceof Y.Text ? text.toJSON() : text;
  };

  /** A local DOM mutation with NO preceding `beforeinput` — paste / inline tool. */
  const mutateWithoutBeforeinput = (block: Block, text: string): void => {
    (block.save as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { text } });
    (blockManager as unknown as BlockManagerPrivate)
      .blockDidMutated(BlockChangedMutationType, block, { index: repository.getBlockIndex(block) });
  };

  /** A local keystroke: `beforeinput` first, then the mutation. */
  const typeInto = (block: Block, text: string): void => {
    blockManager.noteUserInput(block.inputs[0]);
    mutateWithoutBeforeinput(block, text);
  };

  const fireAnimationFrames = (): void => {
    const pending = rafCallbacks;

    rafCallbacks = [];
    pending.forEach((callback) => callback(0));
  };

  const settle = async (): Promise<void> => {
    await drainMicrotasks();
    fireAnimationFrames();
    await drainMicrotasks();
    fireAnimationFrames();
    await drainMicrotasks();
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

    blockA = createStubBlock('A', 'a');
    blockB = createStubBlock('B', 'b');
    rawBlocksStore.push(blockA);
    rawBlocksStore.push(blockB);

    const blocksStore = new Proxy(rawBlocksStore, {
      set: Blocks.set,
      get: Blocks.get,
    }) as unknown as BlocksStore;

    repository = new BlockRepository();
    repository.initialize(blocksStore);

    const factory = {
      composeBlock: vi.fn((params: { id: string; data: { text?: string } }) =>
        createStubBlock(params.id, params.data?.text ?? '')),
      getTool: (): undefined => undefined,
      hasTool: (name: string): boolean => name === 'paragraph',
    } as unknown as BlockFactory;

    blockManager = new BlockManager({ config,
      eventsDispatcher: dispatcher });
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
      resyncBlockData: (block: Block): void => {
        void (blockManager as unknown as { syncBlockDataToYjs: (b: Block) => Promise<void> })
          .syncBlockDataToYjs(block);
      },
    };

    yjsSync = new BlockYjsSync({ YjsManager: manager }, repository, factory, handlers, blocksStore);
    unsubscribe = yjsSync.subscribe();
    (blockManager as unknown as BlockManagerPrivate).yjsSync = yjsSync;
    (blockManager as unknown as { repository: BlockRepository }).repository = repository;

    manager.state = {
      BlockManager: {
        getBlockById: (id: string): Block | undefined => repository.getBlockById(id),
        getBlockByChildNode: (node: Node): Block | undefined => repository.getBlockByChildNode(node),
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

  const pushPeerUpdate = (): void => {
    manager.applyRemoteUpdate(peer.encodeStateAsUpdate(manager.getStateVector()));
  };

  it('control: a paste with nothing reconciling reaches the document', async () => {
    mutateWithoutBeforeinput(blockA, 'a pasted');
    await settle();

    expect(readText('A')).toBe('a pasted');
  });

  it('control: a keystroke inside a peer reconcile window reaches the document', async () => {
    peer.updateBlockData('A', 'text', 'peer typed');
    pushPeerUpdate();

    typeInto(blockA, 'peer typed + keystroke');
    await settle();

    expect(readText('A')).toBe('peer typed + keystroke');
  });

  it('keeps a PASTE made while a peer edit of that block reconciles', async () => {
    peer.updateBlockData('A', 'text', 'peer typed');
    pushPeerUpdate();

    // No beforeinput: the Paste module preventDefaults the clipboard event.
    mutateWithoutBeforeinput(blockA, 'peer typed + pasted');
    await settle();

    expect(readText('A')).toBe('peer typed + pasted');
  });

  it('keeps an INLINE TOOL edit made while a peer edit of that block reconciles', async () => {
    peer.updateBlockData('A', 'text', 'peer typed');
    pushPeerUpdate();

    // Bold rewrites the DOM through the mark engine — no input event at all.
    mutateWithoutBeforeinput(blockA, '<b>peer typed</b>');
    await settle();

    expect(readText('A')).toBe('<b>peer typed</b>');
  });

  it('keeps a PASTE into ANOTHER block while a peer INSERT reconciles', async () => {
    // handleYjsAdd opens an UNSCOPED window, so every block is suppressed.
    peer.addBlock({ id: 'C', type: 'paragraph', data: { text: 'peer block' } });
    pushPeerUpdate();

    mutateWithoutBeforeinput(blockB, 'b pasted');
    await settle();

    expect(readText('B')).toBe('b pasted');
  });

  it('does not lose the paste permanently once every window has closed', async () => {
    peer.updateBlockData('A', 'text', 'peer typed');
    pushPeerUpdate();
    mutateWithoutBeforeinput(blockA, 'peer typed + pasted');
    await settle();

    // A later, unrelated peer edit on B opens and closes another window; if the
    // drop were merely deferred, A's paste would land by now.
    peer.updateBlockData('B', 'text', 'peer b');
    pushPeerUpdate();
    await settle();

    expect(readText('A')).toBe('peer typed + pasted');
  });

  it('does not let a save() still in flight overwrite the peer edit that landed meanwhile', async () => {
    let releaseSave: (value: { data: { text: string } }) => void = () => undefined;

    (blockB.save as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise<{ data: { text: string } }>((resolve) => {
        releaseSave = resolve;
      })
    );

    blockManager.noteUserInput(blockB.inputs[0]);
    (blockManager as unknown as BlockManagerPrivate)
      .blockDidMutated(BlockChangedMutationType, blockB, { index: 1 });
    await drainMicrotasks();

    // The peer's edit lands while the local save is still pending.
    peer.updateBlockData('B', 'text', 'peer wrote this');
    pushPeerUpdate();
    await drainMicrotasks();

    releaseSave({ data: { text: 'b typed' } });
    await settle();

    expect(readText('B')).toContain('peer wrote this');
  });

  it('refutation probe: a peer edit to a DIFFERENT key mid-coalescing-window', async () => {
    typeInto(blockA, 'a1');
    await drainMicrotasks();
    typeInto(blockA, 'a12');
    await drainMicrotasks();

    peer.updateBlockData('A', 'level', 3);
    pushPeerUpdate();
    await settle();

    manager.flushPendingBlockWrites();

    const data = manager.getBlockById('A')?.get('data');
    const level = data instanceof Y.Map ? data.get('level') : undefined;

    expect(level).toBe(3);
    expect(readText('A')).toBe('a12');
  });

  it('refutation probe: a peer edit to the SAME key mid-coalescing-window', async () => {
    typeInto(blockA, 'a1');
    await drainMicrotasks();
    // Second keystroke coalesces into the open 400ms window instead of writing.
    typeInto(blockA, 'a12');
    await drainMicrotasks();

    peer.updateBlockData('A', 'text', 'a peer');
    pushPeerUpdate();
    await settle();

    manager.flushPendingBlockWrites();

    // Both edits survive the merge: the peer's inserted run AND the local
    // characters. Their relative order is CRDT tie-breaking on a random
    // clientID and differs per run, so only presence can be asserted.
    expect(readText('A')).toContain('peer');
    expect(readText('A')).toContain('12');
  });
});
