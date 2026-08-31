import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import { Blocks } from '../../../../../src/components/blocks';
import type { Block } from '../../../../../src/components/block';
import { BlockYjsSync, type SyncHandlers } from '../../../../../src/components/modules/blockManager/yjs-sync';
import { BlockRepository } from '../../../../../src/components/modules/blockManager/repository';
import type { BlockFactory } from '../../../../../src/components/modules/blockManager/factory';
import type { BlocksStore, ComposeBlockOptions } from '../../../../../src/components/modules/blockManager/types';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import type { BlockChangeEvent } from '../../../../../src/components/modules/yjs/types';

/**
 * Task 7 integration pins: remote reconciliation through the BINARY SEAM.
 *
 * Peer state is built on a second real DocumentStore and shipped as encoded
 * updates via applyRemoteUpdate — the exact path a provider uses — so every
 * event flows through the real observer classification, never a hand-built
 * BlockChangeEvent. The local side wires a real YjsManager to a real
 * BlockYjsSync over a real repository/Blocks store of stub blocks.
 */

interface StubBlockSeed {
  id: string;
  name?: string;
  parentId?: string | null;
  contentIds?: string[];
}

/** Stub block with the mutable fields the reconciler writes. */
interface MutableStubBlock {
  parentId: string | null;
  contentIds: string[];
}

interface DocSeedBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;
  parent?: string;
  content?: string[];
}

const paragraph = (id: string, extra: { parent?: string; content?: string[] } = {}): DocSeedBlock => ({
  id,
  type: 'paragraph',
  data: { text: id },
  ...extra,
});

const toggle = (id: string, content: string[]): DocSeedBlock => ({
  id,
  type: 'toggle',
  data: { text: id },
  content,
});

const createStubBlock = (seed: StubBlockSeed): Block => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');

  return {
    id: seed.id,
    name: seed.name ?? 'paragraph',
    holder,
    parentId: seed.parentId ?? null,
    contentIds: seed.contentIds ?? [],
    inputs: [],
    preservedTunes: {},
    setData: vi.fn(() => Promise.resolve(true)),
    call: vi.fn(),
    destroy: vi.fn(),
  } as unknown as Block;
};

const asMutable = (block: Block): MutableStubBlock => block;

/**
 * One macrotask covers the reconciler's microtask chains (move sync, holder
 * reconcile) AND the async setData hop inside withAtomicOperationAsync.
 */
const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('BlockYjsSync — remote reconciliation through the binary seam (integration)', () => {
  let manager: YjsManager;
  let peer: DocumentStore;
  let repository: BlockRepository;
  let blocksStore: BlocksStore;
  let workingArea: HTMLElement;
  let handlers: SyncHandlers;
  let yjsSync: BlockYjsSync;
  let unsubscribe: (() => void) | null = null;
  let composeBlockSpy: ReturnType<typeof vi.fn>;

  /**
   * In-memory half of setBlockParent, mirroring BlockHierarchy semantics:
   * a dangling parent is sanitized to null in memory (the doc keeps the
   * relationship for when the parent arrives — orphan tolerance).
   */
  const inMemoryReparent = (block: Block, newParentId: string | null): void => {
    const parentExists = newParentId === null || repository.getBlockById(newParentId) !== undefined;
    const sanitizedParentId = parentExists ? newParentId : null;

    if (block.parentId !== null) {
      const oldParent = repository.getBlockById(block.parentId);

      if (oldParent !== undefined) {
        oldParent.contentIds = oldParent.contentIds.filter((id) => id !== block.id);
      }
    }

    asMutable(block).parentId = sanitizedParentId;

    if (sanitizedParentId !== null) {
      const newParent = repository.getBlockById(sanitizedParentId);

      if (newParent !== undefined && !newParent.contentIds.includes(block.id)) {
        newParent.contentIds = [...newParent.contentIds, block.id];
      }
    }
  };

  const createHarness = (seed: DocSeedBlock[]): void => {
    manager = new YjsManager({
      config: {},
      eventsDispatcher: {
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
      } as unknown as YjsManager['eventsDispatcher'],
    });

    workingArea = document.createElement('div');
    document.body.appendChild(workingArea);

    const rawBlocksStore = new Blocks(workingArea);

    for (const block of seed) {
      rawBlocksStore.push(createStubBlock({
        id: block.id,
        name: block.type,
        parentId: block.parent ?? null,
        contentIds: block.content !== undefined ? [...block.content] : [],
      }));
    }

    blocksStore = new Proxy(rawBlocksStore, {
      set: Blocks.set,
      get: Blocks.get,
    }) as unknown as BlocksStore;

    repository = new BlockRepository();
    repository.initialize(blocksStore);

    composeBlockSpy = vi.fn((options: ComposeBlockOptions): Block => createStubBlock({
      id: options.id ?? 'missing-id',
      name: options.tool,
      parentId: options.parentId ?? null,
      contentIds: options.contentIds !== undefined ? [...options.contentIds] : [],
    }));

    const factory = {
      composeBlock: composeBlockSpy,
      getTool: (): undefined => undefined,
      hasTool: (): boolean => true,
    } as unknown as BlockFactory;

    handlers = {
      addToDom: vi.fn(),
      removeFromDom: vi.fn(),
      moveInDom: vi.fn(),
      getBlockIndex: (block: Block): number => repository.getBlockIndex(block),
      insertDefaultBlock: vi.fn(() => createStubBlock({ id: 'default' })),
      updateIndentation: vi.fn(),
      setBlockParent: vi.fn((block: Block, parentId: string | null) => {
        inMemoryReparent(block, parentId);
      }),
      replaceBlock: vi.fn(),
      onBlockRemoved: vi.fn(),
      onBlockAdded: vi.fn(),
    };

    yjsSync = new BlockYjsSync({ YjsManager: manager }, repository, factory, handlers, blocksStore);
    unsubscribe = yjsSync.subscribe();

    // Minimal BlockManager surface the move-replay path reaches
    // (reparentInMemoryFromReplay + caret snapshot capture).
    manager.state = {
      BlockManager: {
        getBlockById: (id: string): Block | undefined => repository.getBlockById(id),
        getBlockByChildNode: (): undefined => undefined,
        currentBlock: undefined,
        reparentFromHistoryReplay: (block: Block, parentId: string | null): void => {
          inMemoryReparent(block, parentId);
        },
      },
    } as unknown as BlokModules;

    manager.fromJSON(seed);

    peer = new DocumentStore(new YBlockSerializer());
  };

  /** Bring the peer up to the local doc's current state. */
  const syncPeerUp = (): void => {
    peer.applyRemoteUpdate(manager.encodeStateAsUpdate(peer.getStateVector()));
  };

  /** Ship the peer's new ops to the local editor through the seam. */
  const applyPeerToLocal = (): void => {
    manager.applyRemoteUpdate(peer.encodeStateAsUpdate(manager.getStateVector()));
  };

  const yjsIds = (): string[] => manager.toJSON().map((block) => block.id ?? '(no id)');
  const memoryIds = (): string[] => repository.blocks.map((block) => block.id);

  /**
   * THE Task 7 order invariant: the in-memory array driving the DOM must
   * equal the doc's derived flat order, exactly.
   */
  const expectOrderInvariant = (step: string, expectedIds: string[]): void => {
    expect(memoryIds(), `in-memory order diverged from YjsManager.toJSON() after: ${step}`).toEqual(yjsIds());
    expect(memoryIds(), `unexpected document order after: ${step}`).toEqual(expectedIds);
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (unsubscribe !== null) {
      unsubscribe();
      unsubscribe = null;
    }
    peer.destroy();
    manager.destroy();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('remote single add', () => {
    it('materializes the block at the derived position, in memory and in the DOM', async () => {
      createHarness([paragraph('b1'), paragraph('b2'), paragraph('b3')]);
      syncPeerUp();

      peer.addBlock(paragraph('r1'), 1);
      applyPeerToLocal();
      await flush();

      expectOrderInvariant('remote add of r1 at index 1', ['b1', 'r1', 'b2', 'b3']);
      expect(composeBlockSpy).toHaveBeenCalledTimes(1);

      const options = composeBlockSpy.mock.calls[0][0] as ComposeBlockOptions;

      expect(options.id).toBe('r1');
      expect(options.tool).toBe('paragraph');

      // All blocks are root-level, so holders mirror the array exactly.
      expect(Array.from(workingArea.children)).toEqual(repository.blocks.map((block) => block.holder));
    });
  });

  describe('remote batch-add (parent + children in one update)', () => {
    it('materializes the hierarchy through the two-pass path', async () => {
      createHarness([paragraph('b1')]);
      syncPeerUp();

      const events: BlockChangeEvent[] = [];
      const off = manager.onBlocksChanged((event) => {
        events.push(event);
      });

      // Three peer transactions, ONE encoded update: the local doc applies
      // them as a single transaction, so the observer must emit batch-add.
      peer.addBlock(toggle('parent-t', []));
      peer.addBlock(paragraph('c1', { parent: 'parent-t' }));
      peer.addBlock(paragraph('c2', { parent: 'parent-t' }));
      applyPeerToLocal();
      await flush();
      off();

      const batchEvents = events.filter((event) => event.type === 'batch-add');

      expect(batchEvents).toHaveLength(1);
      expect([...(batchEvents[0] as { blockIds: string[] }).blockIds].sort()).toEqual(['c1', 'c2', 'parent-t']);

      expectOrderInvariant('remote batch-add of parent-t + c1 + c2', ['b1', 'parent-t', 'c1', 'c2']);

      const parent = repository.getBlockById('parent-t');
      const child1 = repository.getBlockById('c1');
      const child2 = repository.getBlockById('c2');

      expect(child1?.parentId).toBe('parent-t');
      expect(child2?.parentId).toBe('parent-t');
      expect(parent?.contentIds).toEqual(['c1', 'c2']);
    });
  });

  describe('remote remove', () => {
    it('tears the block down: array, DOM holder, destroy()', async () => {
      createHarness([paragraph('b1'), paragraph('b2'), paragraph('b3')]);
      syncPeerUp();

      const removed = repository.getBlockById('b2');

      if (removed === undefined) {
        throw new Error('seed block b2 missing');
      }

      peer.removeBlock('b2');
      applyPeerToLocal();
      await flush();

      expectOrderInvariant('remote remove of b2', ['b1', 'b3']);
      expect(removed.destroy).toHaveBeenCalledTimes(1);
      expect(removed.holder.isConnected).toBe(false);
    });
  });

  describe('remote move (order-array change)', () => {
    it('drives the full-order resync without recreating or destroying any block', async () => {
      createHarness([paragraph('b1'), paragraph('b2'), paragraph('b3')]);
      syncPeerUp();

      const before = repository.blocks.map((block) => block);

      peer.moveBlock('b3', 0, 'local');
      applyPeerToLocal();
      await flush();

      expectOrderInvariant('remote move of b3 to index 0', ['b3', 'b1', 'b2']);

      // Schema v2 headline: a move edits order arrays only — identity survives.
      expect(composeBlockSpy).not.toHaveBeenCalled();
      for (const block of before) {
        expect(block.destroy).not.toHaveBeenCalled();
        expect(repository.getBlockById(block.id)).toBe(block);
      }

      expect(Array.from(workingArea.children)).toEqual(repository.blocks.map((block) => block.holder));
    });
  });

  describe('remote reparent (parentId + order membership in one transaction)', () => {
    it('reconciles the parent AND the derived position', async () => {
      createHarness([toggle('t1', []), paragraph('p1'), paragraph('p2')]);
      syncPeerUp();

      peer.applyPlacement('p2', { parentId: 't1', afterId: null }, 'local');
      applyPeerToLocal();
      await flush();

      expectOrderInvariant('remote reparent of p2 under t1', ['t1', 'p2', 'p1']);

      const child = repository.getBlockById('p2');
      const parent = repository.getBlockById('t1');

      expect(child?.parentId).toBe('t1');
      expect(parent?.contentIds).toEqual(['p2']);
    });
  });

  describe('remote root promotion (parentId key deleted remotely)', () => {
    it('lands the block at root through the real observer', async () => {
      createHarness([
        toggle('t1', ['c1']),
        paragraph('c1', { parent: 't1' }),
        paragraph('p1'),
      ]);
      syncPeerUp();

      peer.applyPlacement('c1', { parentId: null, afterId: 't1' }, 'local');
      applyPeerToLocal();
      await flush();

      expectOrderInvariant('remote root promotion of c1', ['t1', 'c1', 'p1']);

      const child = repository.getBlockById('c1');
      const oldParent = repository.getBlockById('t1');

      expect(child?.parentId).toBeNull();
      expect(oldParent?.contentIds).toEqual([]);
      expect(manager.getBlockById('c1')?.has('parentId')).toBe(false);
    });
  });

  describe('order invariant across a mixed local/remote/undo sequence', () => {
    /**
     * Local ops mirror BlockManager's contract: mutate memory FIRST, then
     * write the doc (local-origin events are filtered by BlockYjsSync).
     */
    const localAddParagraph = (id: string, index: number): void => {
      blocksStore.insert(index, createStubBlock({ id }));
      manager.addBlock(paragraph(id), index);
    };

    const localMove = (id: string, toIndex: number): void => {
      const block = repository.getBlockById(id);

      if (block === undefined) {
        throw new Error(`localMove: unknown block ${id}`);
      }

      blocksStore.move(toIndex, repository.getBlockIndex(block));
      manager.moveBlock(id, toIndex);
    };

    /** Keyboard-nesting analogue: reparent inside a move group. */
    const localReparent = (id: string, parentId: string, afterId: string | null): void => {
      const block = repository.getBlockById(id);

      if (block === undefined) {
        throw new Error(`localReparent: unknown block ${id}`);
      }

      manager.transactMoves(() => {
        const from = manager.getBlockPlacement(id);
        const to = { parentId, afterId };

        inMemoryReparent(block, parentId);
        manager.applyBlockPlacement(id, to, { capture: false });

        if (from !== null) {
          manager.recordParentChangeForPendingMove(id, from, to);
        }
      });
    };

    it('BlockManager.blocks order equals YjsManager.toJSON() order after every step', async () => {
      createHarness([toggle('t1', []), paragraph('p1'), paragraph('p2')]);
      expectOrderInvariant('seed', ['t1', 'p1', 'p2']);

      localAddParagraph('p3', 3);
      await flush();
      expectOrderInvariant('local add of p3 at the end', ['t1', 'p1', 'p2', 'p3']);

      localMove('p2', 1);
      await flush();
      expectOrderInvariant('local move of p2 to index 1', ['t1', 'p2', 'p1', 'p3']);

      syncPeerUp();
      peer.addBlock(paragraph('r1'), 2);
      applyPeerToLocal();
      await flush();
      expectOrderInvariant('remote insert of r1 at index 2', ['t1', 'p2', 'r1', 'p1', 'p3']);

      localReparent('p2', 't1', null);
      await flush();
      expectOrderInvariant('local reparent of p2 under t1', ['t1', 'p2', 'r1', 'p1', 'p3']);
      expect(repository.getBlockById('p2')?.parentId).toBe('t1');

      syncPeerUp();
      peer.moveBlock('p3', 2, 'local');
      applyPeerToLocal();
      await flush();
      expectOrderInvariant('remote reorder of p3 to index 2', ['t1', 'p2', 'p3', 'r1', 'p1']);

      manager.undo();
      await flush();
      expectOrderInvariant('undo of the local reparent', ['t1', 'p2', 'p3', 'r1', 'p1']);
      expect(repository.getBlockById('p2')?.parentId).toBeNull();
      expect(repository.getBlockById('t1')?.contentIds).toEqual([]);

      manager.redo();
      await flush();
      expectOrderInvariant('redo of the local reparent', ['t1', 'p2', 'p3', 'r1', 'p1']);
      expect(repository.getBlockById('p2')?.parentId).toBe('t1');
      expect(repository.getBlockById('t1')?.contentIds).toEqual(['p2']);
    });
  });

  describe('dangling-parent tolerance end-to-end', () => {
    it('renders an orphan at the end without throwing, then adopts it when the parent arrives', async () => {
      createHarness([paragraph('b1')]);
      syncPeerUp();

      // The referenced parent exists NOWHERE yet — the block is an orphan
      // on the peer too (in no order array, rendered from the orphan tail).
      peer.addBlock(paragraph('stray', { parent: 'ghost' }));

      expect(() => {
        applyPeerToLocal();
      }).not.toThrow();
      await flush();

      expectOrderInvariant('remote add of stray with a dangling parent', ['b1', 'stray']);

      const stray = repository.getBlockById('stray');

      // In-memory tolerance mirrors the doc's: sanitized to root, while the
      // doc keeps parentId = ghost for when the parent arrives.
      expect(stray?.parentId).toBeNull();
      expect(manager.getBlockById('stray')?.get('parentId')).toBe('ghost');

      // The parent arrives in a LATER update, claiming the stray child.
      peer.addBlock(toggle('ghost', ['stray']));
      applyPeerToLocal();
      await flush();

      expectOrderInvariant('remote arrival of the ghost parent', ['b1', 'ghost', 'stray']);
      expect(stray?.parentId).toBe('ghost');
      expect(repository.getBlockById('ghost')?.contentIds).toEqual(['stray']);
    });
  });
});
