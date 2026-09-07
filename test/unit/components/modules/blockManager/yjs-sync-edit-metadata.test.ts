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
 * A transaction under an origin outside LOCAL_ORIGIN_TAGS is what a
 * provider-applied update looks like, so this drives the real remote path.
 */
const UNKNOWN_ORIGIN = 'test-provider';

interface MetadataFields {
  lastEditedAt?: number;
  lastEditedBy?: string | null;
}

const createMockBlock = (options: {
  id: string;
  name?: string;
  setDataResult?: boolean;
} & MetadataFields): Block => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');

  return {
    id: options.id,
    holder,
    parentId: null,
    contentIds: [],
    preservedTunes: {},
    lastEditedAt: options.lastEditedAt,
    lastEditedBy: options.lastEditedBy ?? null,
    setData: vi.fn(() => Promise.resolve(options.setDataResult ?? true)) as unknown as Block['setData'],
    call: vi.fn(),
    destroy: vi.fn(),
    name: options.name ?? 'paragraph',
    tool: {} as BlockToolAdapter,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    destroyEvents: vi.fn(),
  } as unknown as Block;
};

const createBlocksStore = (blocks: Block[]): BlocksStore => {
  const workingArea = document.createElement('div');
  const blocksStore = new Blocks(workingArea);

  for (const block of blocks) {
    blocksStore.push(block);
  }

  return new Proxy(blocksStore, {
    set: Blocks.set,
    get: Blocks.get,
  }) as unknown as BlocksStore;
};

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('BlockYjsSync — edit metadata from the document', () => {
  let manager: YjsManager;
  let repository: BlockRepository;
  let factory: BlockFactory;
  let handlers: SyncHandlers;
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

    repository = new BlockRepository();
    repository.initialize(blocksStore);

    const tools = new ToolsCollection<BlockToolAdapter>();

    tools.set('paragraph', {} as unknown as BlockToolAdapter);

    factory = new BlockFactory({
      API: {} as API,
      eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
      tools,
      moduleInstances: {
        ReadOnly: { isEnabled: false },
      } as never,
    }, vi.fn());

    handlers = {
      getBlockIndex: vi.fn((block: Block) => repository.getBlockIndex(block)),
      insertDefaultBlock: vi.fn(() => createMockBlock({ id: 'default' })),
      setBlockParent: vi.fn((block: Block, parentId: string | null) => {
        const target = block as { parentId: string | null };

        target.parentId = parentId;
      }),
      replaceBlock: vi.fn(),
      onBlockRemoved: vi.fn(),
      onBlockAdded: vi.fn(),
    };

    const dependencies: BlockYjsSyncDependencies = { YjsManager: manager };

    yjsSync = new BlockYjsSync(dependencies, repository, factory, handlers, blocksStore);
    unsubscribe = yjsSync.subscribe();
  };

  const remoteTransact = (anyBlockId: string, fn: () => void): void => {
    const yblock = manager.getBlockById(anyBlockId);

    if (yblock === undefined || yblock.doc === null) {
      throw new Error(`No Y.Doc reachable via block "${anyBlockId}"`);
    }

    (yblock.doc).transact(fn, UNKNOWN_ORIGIN);
  };

  const editRemotely = (blockId: string, text: string, metadata: MetadataFields): void => {
    remoteTransact(blockId, () => {
      const yblock = manager.getBlockById(blockId);
      const ydata = yblock?.get('data') as Y.Map<unknown>;

      ydata.set('text', text);

      if (metadata.lastEditedAt !== undefined) {
        yblock?.set('lastEditedAt', metadata.lastEditedAt);
      }

      if (metadata.lastEditedBy !== undefined && metadata.lastEditedBy !== null) {
        yblock?.set('lastEditedBy', metadata.lastEditedBy);
      }
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (unsubscribe !== null) {
      unsubscribe();
      unsubscribe = null;
    }
    vi.restoreAllMocks();
  });

  it('adopts the peer edit stamps when the block takes the data in place', async () => {
    const block = createMockBlock({ id: 'block-1', lastEditedAt: 111, lastEditedBy: 'user-local' });

    createHarness([block]);
    manager.fromJSON([{ id: 'block-1', type: 'paragraph', data: { text: 'hello' } }]);

    editRemotely('block-1', 'typed by a peer', { lastEditedAt: 999, lastEditedBy: 'user-peer' });

    await flush();

    expect(block.lastEditedBy).toBe('user-peer');
    expect(block.lastEditedAt).toBe(999);
    expect(block.setData).toHaveBeenCalledTimes(1);
  });

  it('adopts the peer edit stamps when the block has to be recreated', async () => {
    const block = createMockBlock({
      id: 'block-1',
      lastEditedAt: 111,
      lastEditedBy: 'user-local',
      setDataResult: false,
    });

    createHarness([block]);
    manager.fromJSON([{ id: 'block-1', type: 'paragraph', data: { text: 'hello' } }]);

    const composed = createMockBlock({ id: 'block-1' });
    const compose = vi.spyOn(factory, 'composeBlock').mockReturnValue(composed);

    editRemotely('block-1', 'typed by a peer', { lastEditedAt: 999, lastEditedBy: 'user-peer' });

    await flush();

    expect(compose).toHaveBeenCalledTimes(1);
    expect(compose.mock.calls[0][0].lastEditedAt).toBe(999);
    expect(compose.mock.calls[0][0].lastEditedBy).toBe('user-peer');
  });

  it('takes the time and the author as one record', async () => {
    const block = createMockBlock({ id: 'block-1', lastEditedAt: 111, lastEditedBy: 'user-local' });

    createHarness([block]);
    manager.fromJSON([{ id: 'block-1', type: 'paragraph', data: { text: 'hello' } }]);

    // A doc record with no stamps at all describes no edit, so keeping the old
    // time while nulling the author would leave the two halves disagreeing.
    remoteTransact('block-1', () => {
      const yblock = manager.getBlockById('block-1');

      (yblock?.get('data') as Y.Map<unknown>).set('text', 'written by a client that stamps nothing');
    });

    await flush();

    expect(block.lastEditedBy).toBeNull();
    expect(block.lastEditedAt).toBeUndefined();
  });

  it('forgets the author when the peer edit dropped it', async () => {
    const block = createMockBlock({ id: 'block-1', lastEditedAt: 111, lastEditedBy: 'user-local' });

    createHarness([block]);
    manager.fromJSON([{
      id: 'block-1',
      type: 'paragraph',
      data: { text: 'hello' },
      lastEditedAt: 111,
      lastEditedBy: 'user-local',
    }]);

    // A peer with no configured identity edits: their client stamps the time
    // and removes the author, so the block must not keep crediting the old one.
    remoteTransact('block-1', () => {
      const yblock = manager.getBlockById('block-1');

      (yblock?.get('data') as Y.Map<unknown>).set('text', 'typed by an anonymous peer');
      yblock?.set('lastEditedAt', 999);
      yblock?.delete('lastEditedBy');
    });

    await flush();

    expect(block.lastEditedBy).toBeNull();
    expect(block.lastEditedAt).toBe(999);
  });
});
