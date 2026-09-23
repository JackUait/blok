import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';

import type { BlokConfig } from '../../../../../types';
import { BlockChangedMutationType } from '../../../../../types/events/block/BlockChanged';
import type { Block } from '../../../../../src/components/block';
import { Blocks } from '../../../../../src/components/blocks';
import { BlockManager } from '../../../../../src/components/modules/blockManager/blockManager';
import { BlockRepository } from '../../../../../src/components/modules/blockManager/repository';
import type { BlocksStore } from '../../../../../src/components/modules/blockManager/types';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import { modificationsObserverBatchTimeout } from '../../../../../src/components/constants';

/**
 * A top-level data key the tool's save() stops emitting used to survive in the
 * shared document forever: the write path is per-key, so nothing anywhere
 * deleted one. A migrated list then re-derived its text from the legacy `items`
 * array on every load, a callout's colour reset to its legacy `variant`, and
 * every "turn off" control (autoplay, alt text, colWidths…) reverted on reload.
 *
 * The prune belongs to the FULL-SAVE flush only. The patch path takes a
 * PARTIAL patch by design, so pruning there would delete everything the caller
 * did not mention.
 *
 * Real YjsManager + the real `BlockManager.blockDidMutated` → `syncBlockDataToYjs`
 * → `flushBlockDataWrites` chain; only the blocks are stubs.
 */

interface BlockManagerPrivateAccess {
  yjsSync: { isSyncingFromYjs: boolean; isMaterializing: (block: Block) => boolean };
  repository: BlockRepository;
  blockDidMutated: (mutationType: string, block: unknown, detail: Record<string, unknown>) => unknown;
}

interface BlockStub {
  id: string;
  name: string;
  parentId: string | null;
  holder: HTMLElement;
  tool: { name: string };
  save: ReturnType<typeof vi.fn>;
  isDerivedChange: boolean;
  lastEditedAt?: number;
  lastEditedBy?: string | null;
}

interface SeedBlock {
  id: string;
  name: string;
  parentId?: string | null;
  data: Record<string, unknown>;
  sanitizeConfig?: Record<string, unknown>;
}

interface Harness {
  yjsManager: YjsManager;
  /** One DOM mutation of `blockId` whose save() yields exactly `data`. */
  mutate: (blockId: string, data: Record<string, unknown>) => Promise<void>;
  /** The block's `data` straight off the Y.Map (toJSON on the manager is a flush barrier). */
  readData: (blockId: string) => Record<string, unknown> | undefined;
  /** A tool reporting derived data (a measured size) whose save() yields exactly `data`. */
  derive: (blockId: string, data: Record<string, unknown>) => Promise<void>;
  /** The editor normalising `blockId` to a save() that yields exactly `data`. */
  normalize: (blockId: string, data: Record<string, unknown>, options?: { onlyMissingKeys?: boolean }) => Promise<void>;
}

const drainMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

const createStubBlock = (seed: SeedBlock): BlockStub => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');

  return {
    id: seed.id,
    name: seed.name,
    parentId: seed.parentId ?? null,
    holder,
    contentIds: [],
    inputs: [],
    preservedData: {},
    preservedTunes: {},
    tool: { name: seed.name, sanitizeConfig: seed.sanitizeConfig },
    save: vi.fn(),
    isDerivedChange: false,
    setData: vi.fn(() => Promise.resolve(true)),
    call: vi.fn(),
    destroy: vi.fn(),
  } as unknown as BlockStub;
};

const createHarness = (seed: SeedBlock[]): Harness => {
  const config: BlokConfig = { defaultBlock: 'paragraph', user: { id: 'user-1' } };
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const yjsManager = new YjsManager({ config, eventsDispatcher });
  const blockManager = new BlockManager({ config, eventsDispatcher });

  blockManager.state = { YjsManager: yjsManager } as unknown as BlokModules;

  const priv = blockManager as unknown as BlockManagerPrivateAccess;

  priv.yjsSync = { isSyncingFromYjs: false, isMaterializing: (): boolean => false };

  const workingArea = document.createElement('div');

  document.body.appendChild(workingArea);

  const rawBlocksStore = new Blocks(workingArea);
  const stubs = new Map<string, BlockStub>();

  for (const block of seed) {
    const stub = createStubBlock(block);

    stubs.set(block.id, stub);
    rawBlocksStore.push(stub as unknown as Block);
  }

  const blocksStore = new Proxy(rawBlocksStore, {
    set: Blocks.set,
    get: Blocks.get,
  }) as unknown as BlocksStore;

  // `isStructurallyNestedListItem` resolves a block's parent through the
  // repository, which prepare() would have wired.
  const repository = new BlockRepository();

  repository.initialize(blocksStore);
  priv.repository = repository;

  for (const block of seed) {
    yjsManager.addBlock({ id: block.id, type: block.name, data: block.data });
  }

  // Detach the seed transactions from the writes under test.
  yjsManager.stopCapturing();

  return {
    yjsManager,
    mutate: async (blockId: string, data: Record<string, unknown>): Promise<void> => {
      const stub = stubs.get(blockId);

      if (stub === undefined) {
        throw new Error(`test setup: block ${blockId} was never seeded`);
      }

      stub.save.mockResolvedValue({ data });
      priv.blockDidMutated(BlockChangedMutationType, stub, { index: 0 });

      await drainMicrotasks();
    },
    readData: (blockId: string): Record<string, unknown> | undefined => {
      const data = yjsManager.getBlockById(blockId)?.get('data');

      return data instanceof Y.Map ? data.toJSON() : undefined;
    },
    derive: async (blockId: string, data: Record<string, unknown>): Promise<void> => {
      const stub = stubs.get(blockId);

      if (stub === undefined) {
        throw new Error(`test setup: block ${blockId} was never seeded`);
      }

      stub.save.mockResolvedValue({ data });
      stub.isDerivedChange = true;
      priv.blockDidMutated(BlockChangedMutationType, stub, { index: 0 });
      stub.isDerivedChange = false;

      await drainMicrotasks();
    },
    normalize: async (blockId: string, data: Record<string, unknown>, options?: { onlyMissingKeys?: boolean }): Promise<void> => {
      const stub = stubs.get(blockId);

      if (stub === undefined) {
        throw new Error(`test setup: block ${blockId} was never seeded`);
      }

      stub.save.mockResolvedValue({ data });
      blockManager.normalizeBlockData(stub as unknown as Block, options);

      await drainMicrotasks();
    },
  };
};

describe('full-save flush prunes dropped top-level data keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('removes a top-level key the new save no longer carries', async () => {
    const { mutate, readData } = createHarness([
      { id: 'callout1', name: 'callout', data: { emoji: '💡', __importedText: 'Hey. Meet the new Blok.' } },
    ]);

    await mutate('callout1', { emoji: '💡' });

    expect(readData('callout1')).toEqual({ emoji: '💡' });
  });

  it('removes a key the coalescing window still carries from an earlier save', async () => {
    const url = 'https://example.test/v.mp4';
    const { mutate, readData } = createHarness([
      { id: 'v1', name: 'video', data: { url, autoplay: true } },
    ]);

    // Leading flush opens the window …
    await mutate('v1', { url, autoplay: true });
    // … a mid-window save leaves `autoplay` in the buffer's pending map …
    await mutate('v1', { url, autoplay: false });
    // … and the newest save drops it, so the coalesced entries still carry
    // `autoplay` while the authoritative key set no longer does.
    await mutate('v1', { url, title: 'clip' });

    await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout);
    await drainMicrotasks();

    expect(readData('v1')).toEqual({ url, title: 'clip' });
  });

  it('does not write — or bump metadata for — a stale buffered key the document never had', async () => {
    const url = 'https://example.test/v.mp4';
    const { yjsManager, mutate, readData } = createHarness([
      { id: 'v2', name: 'video', data: { url } },
    ]);

    await mutate('v2', { url });
    await mutate('v2', { url, autoplay: true });
    await mutate('v2', { url });

    await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout);
    await drainMicrotasks();

    expect(readData('v2')).toEqual({ url });
    // Nothing changed, so the edit metadata must stay untouched — writing the
    // stale key and pruning it again in the same transaction would net out in
    // the data but still stamp a spurious edit.
    expect(yjsManager.getBlockById('v2')?.get('lastEditedAt')).toBeUndefined();
  });

  it('leaves a structurally nested list item its document depth (never pruned)', async () => {
    const { mutate, readData } = createHarness([
      { id: 'l1', name: 'list', data: { text: 'parent', style: 'unordered' } },
      { id: 'l2', name: 'list', parentId: 'l1', data: { text: 'child', style: 'unordered', depth: 1 } },
    ]);

    // `depth` is derived from the parentId chain, so the flush deliberately
    // never writes it — and must therefore never delete it either. Pruning it
    // revives "undo after Tab indentation restores original depth" from the
    // other side.
    await mutate('l2', { text: 'child edited', style: 'unordered' });

    expect(readData('l2')).toEqual({ text: 'child edited', style: 'unordered', depth: 1 });
  });

  it('still refuses to WRITE a structurally nested list item depth', async () => {
    const { mutate, readData } = createHarness([
      { id: 'l1', name: 'list', data: { text: 'parent', style: 'unordered' } },
      { id: 'l2', name: 'list', parentId: 'l1', data: { text: 'child', style: 'unordered', depth: 1 } },
    ]);

    await mutate('l2', { text: 'child', style: 'unordered', depth: 99 });

    expect(readData('l2')?.depth).toBe(1);
  });

  it('prunes a flat-carrier list item that really dropped its depth', async () => {
    // No LIST parent: `depth` is this item's own data, not a derived mirror.
    const { mutate, readData } = createHarness([
      { id: 'flat', name: 'list', data: { text: 'item', style: 'unordered', depth: 2 } },
    ]);

    await mutate('flat', { text: 'item', style: 'unordered' });

    expect(readData('flat')).toEqual({ text: 'item', style: 'unordered' });
  });

  it('never prunes on the patch path — a partial patch names a subset by design', () => {
    const { yjsManager, readData } = createHarness([
      { id: 'tbl', name: 'table', data: { content: [], colWidths: [120, 240], textSize: 'small' } },
    ]);

    yjsManager.updateBlockData('tbl', 'textSize', 'large');

    expect(readData('tbl')).toEqual({ content: [], colWidths: [120, 240], textSize: 'large' });
  });
});

describe('which data writes are undo steps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('makes clearing a key the tool emitted an undo step', async () => {
    const url = 'https://example.test/v.mp4';
    const { yjsManager, mutate, readData } = createHarness([
      { id: 'v1', name: 'video', data: { url, hideControls: true } },
    ]);

    yjsManager.clear();
    await mutate('v1', { url, hideControls: true });
    yjsManager.stopCapturing();
    await mutate('v1', { url });
    await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout);
    await drainMicrotasks();

    expect(readData('v1')).toEqual({ url });

    yjsManager.undo();

    expect(readData('v1')).toEqual({ url, hideControls: true });
  });

  it('prunes a key the tool never emitted without an undo step', async () => {
    const { yjsManager, mutate, readData } = createHarness([
      { id: 'l1', name: 'list', data: { text: 'a', style: 'unordered', checked: false } },
    ]);

    yjsManager.clear();
    await mutate('l1', { text: 'a', style: 'unordered' });

    expect(readData('l1')).toEqual({ text: 'a', style: 'unordered' });
    expect(yjsManager.canUndo()).toBe(false);
  });

  it('writes the save() shape as no undo step and no edit', async () => {
    const { yjsManager, normalize, readData } = createHarness([
      { id: 'h1', name: 'header', data: { text: 'Hi', legacy: true } },
    ]);

    yjsManager.clear();
    await normalize('h1', { text: 'Hi', level: 2 });

    expect(readData('h1')).toEqual({ text: 'Hi', level: 2 });
    expect(yjsManager.canUndo()).toBe(false);
    expect(yjsManager.getBlockById('h1')?.get('lastEditedAt')).toBeUndefined();
  });

  it('only adds missing keys when asked, leaving present values and extra keys alone', async () => {
    const { yjsManager, normalize, readData } = createHarness([
      { id: 'p1', name: 'paragraph', data: { text: '<sup>peer</sup>', extra: 1 } },
    ]);

    yjsManager.clear();
    await normalize('p1', { text: 'peer', align: 'left' }, { onlyMissingKeys: true });

    expect(readData('p1')).toEqual({ text: '<sup>peer</sup>', extra: 1, align: 'left' });
  });

  it('writes derived data without an undo step, keeping redo', async () => {
    const { yjsManager, mutate, derive, readData } = createHarness([
      { id: 'img', name: 'image', data: { url: 'a.png', caption: 'x' } },
    ]);

    yjsManager.clear();
    await mutate('img', { url: 'a.png', caption: 'xy' });
    yjsManager.undo();

    await derive('img', { url: 'a.png', caption: 'x', naturalWidth: 800 });

    expect(readData('img')).toEqual({ url: 'a.png', caption: 'x', naturalWidth: 800 });
    expect(yjsManager.canRedo()).toBe(true);
    expect(yjsManager.canUndo()).toBe(false);
  });

  it('keeps a keystroke still in the write buffer an undo step', async () => {
    const { yjsManager, mutate, normalize, readData } = createHarness([
      { id: 'p2', name: 'paragraph', data: { text: 'a' } },
    ]);

    yjsManager.clear();
    await mutate('p2', { text: 'ab' });
    await mutate('p2', { text: 'abc' });
    await normalize('p2', { text: 'abc', align: 'left' });

    expect(readData('p2')).toEqual({ text: 'abc', align: 'left' });

    yjsManager.undo();

    expect(readData('p2')?.text).toBe('a');
  });
});

describe('what a data write stores', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('stores save() sanitised by the tool config, as the Saver outputs it', async () => {
    const { mutate, readData } = createHarness([
      { id: 'p1', name: 'paragraph', data: { text: 'a' }, sanitizeConfig: { text: { b: true } } },
    ]);

    await mutate('p1', { text: '<b>bold</b><span class="katex">rendered</span>' });

    expect(readData('p1')).toEqual({ text: '<b>bold</b>rendered' });
  });
});
