import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { BlocksAPI } from '../../../../src/components/modules/api/blocks';
import { EventsDispatcher } from '../../../../src/components/utils/events';

import type { BlokEventMap } from '../../../../src/components/events';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { ModuleConfig } from '../../../../src/types-internal/module-config';
import type { BlockToolData } from '../../../../types';

/**
 * Minimal stand-in for a core Block: only the fields BlockAPI actually reads.
 */
type FakeBlock = {
  id: string;
  name: string;
  parentId: string | null;
  contentIds: string[];
  holder: HTMLElement;
};

const createFakeBlock = (id: string, parentId: string | null, contentIds: string[] = []): FakeBlock => ({
  id,
  name: 'paragraph',
  parentId,
  contentIds,
  holder: document.createElement('div'),
});

/**
 * Wires a REAL BlocksAPI against an in-memory flat block list, and points the
 * fake `API` module back at that same instance — exactly the shape core builds
 * at runtime. This is the only way to observe what a handed-out BlockAPI can
 * really do: the BlocksAPI unit suite mocks the BlockAPI constructor away.
 * @returns the api under test plus the spies its BlockManager exposes
 */
const createLiveBlocksApi = (): {
  blocksApi: BlocksAPI;
  flat: FakeBlock[];
  setBlockParent: ReturnType<typeof vi.fn>;
  insertInsideParent: ReturnType<typeof vi.fn>;
  move: ReturnType<typeof vi.fn>;
} => {
  /**
   * p
   * ├── a
   * │   └── a1
   * └── b
   * other
   */
  const flat: FakeBlock[] = [
    createFakeBlock('p', null, ['a', 'b']),
    createFakeBlock('a', 'p', ['a1']),
    createFakeBlock('a1', 'a'),
    createFakeBlock('b', 'p'),
    createFakeBlock('other', null),
  ];

  const setBlockParent = vi.fn();
  const move = vi.fn();
  const insertInsideParent = vi.fn((parentId: string, insertIndex: number, childData?: BlockToolData) => {
    const created = createFakeBlock(`created-${insertIndex}`, parentId);

    void childData;
    flat.splice(insertIndex, 0, created);

    return created;
  });

  const blockManager = {
    get blocks(): FakeBlock[] {
      return flat;
    },
    currentBlockIndex: 0,
    suppressStopCapturing: false,
    getBlockById: (id: string): FakeBlock | undefined => flat.find((block) => block.id === id),
    getBlockByIndex: (index: number): FakeBlock | undefined => flat[index],
    getBlockIndex: (block: FakeBlock): number => flat.indexOf(block),
    setBlockParent,
    insertInsideParent,
    move,
  };

  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const moduleConfig: ModuleConfig = {
    config: { defaultBlock: 'paragraph' },
    eventsDispatcher,
  };

  const blocksApi = new BlocksAPI(moduleConfig);

  blocksApi.state = {
    BlockManager: blockManager,
    YjsManager: { stopCapturing: vi.fn() },
    /**
     * The API module is a thin facade over the very same BlocksAPI instance,
     * mirroring `API.methods.blocks = this.Blok.BlocksAPI.methods`.
     */
    API: {
      get methods() {
        return { blocks: blocksApi.methods };
      },
    },
  } as unknown as BlokModules;

  return {
    blocksApi,
    flat,
    setBlockParent,
    insertInsideParent,
    move,
  };
};

describe('handed-out BlockAPI is live', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getById(...).getChildren() resolves the real children', () => {
    const { blocksApi } = createLiveBlocksApi();

    const parent = blocksApi.getById('p');

    expect(parent).not.toBeNull();
    expect(parent?.getChildren().map((child) => child.id)).toEqual(['a', 'b']);
  });

  it('children handed out by getChildren() are themselves live (depth-1 recursion)', () => {
    const { blocksApi } = createLiveBlocksApi();

    const [firstChild] = blocksApi.getById('p')?.getChildren() ?? [];

    expect(firstChild?.id).toBe('a');
    expect(firstChild?.getChildren().map((grandChild) => grandChild.id)).toEqual(['a1']);
  });

  it('setParent() on a handed-out BlockAPI reaches core setBlockParent', () => {
    const { blocksApi, setBlockParent, flat } = createLiveBlocksApi();

    blocksApi.getById('a')?.setParent(null);

    expect(setBlockParent).toHaveBeenCalledWith(flat.find((block) => block.id === 'a'), null);
  });

  it('insertChild() on a handed-out BlockAPI creates a child and returns it', () => {
    const { blocksApi, insertInsideParent } = createLiveBlocksApi();

    const created = blocksApi.getById('p')?.insertChild({ text: 'nested' });

    // p(0) a(1) a1(2) b(3) → the subtree ends at 3, so 'end' appends at flat index 4.
    expect(insertInsideParent).toHaveBeenCalledWith('p', 4, { text: 'nested' }, undefined, {});
    expect(created).not.toBeNull();
    expect(created?.id).toBe('created-4');
  });

  it('moveChild() on a handed-out BlockAPI reaches core move', () => {
    const { blocksApi, move } = createLiveBlocksApi();

    blocksApi.getById('p')?.moveChild('b', -1);

    // 'b' (flat 3) moves before 'a' (flat 1).
    expect(move).toHaveBeenCalledWith(1, 3);
  });
});
