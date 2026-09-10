import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { Array as YArray, Doc as YDoc, Map as YMap } from 'yjs';

import type { Block } from '../../../../../src/components/block';
import { BlockToolAPI } from '../../../../../src/components/block';
import { Blocks } from '../../../../../src/components/blocks';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { API } from '../../../../../src/components/modules/api';
import { BlockFactory } from '../../../../../src/components/modules/blockManager/factory';
import { BlockRepository } from '../../../../../src/components/modules/blockManager/repository';
import type { BlocksStore, ComposeBlockOptions } from '../../../../../src/components/modules/blockManager/types';
import {
  BlockYjsSync,
  type BlockYjsSyncDependencies,
  type SyncHandlers,
} from '../../../../../src/components/modules/blockManager/yjs-sync';
import type { YjsManager } from '../../../../../src/components/modules/yjs';
import type { BlockChangeEvent } from '../../../../../src/components/modules/yjs/types';
import type { BlockToolAdapter } from '../../../../../src/components/tools/block';
import { ToolsCollection } from '../../../../../src/components/tools/collection';
import * as utils from '../../../../../src/components/utils';
import { EventsDispatcher } from '../../../../../src/components/utils/events';

/**
 * Mutation-kill suite for BlockYjsSync.
 *
 * The reconciler is the seam where another peer's document reaches this
 * client's blocks, so the assertions below are shaped around what a surviving
 * mutant would cost: a remote change landing on the wrong block, an edit
 * dropped by a guard that skipped it, an order two peers would not agree on,
 * and untrusted doc values reaching handlers that assume they are well formed.
 */

/** Every write to a mock block's `contentIds`, so "did not touch it" is testable. */
const contentIdWrites = new WeakMap<Block, string[][]>();

interface MockBlockOptions {
  id: string;
  parentId?: string | null;
  contentIds?: string[];
  name?: string;
  tool?: Partial<BlockToolAdapter>;
  tunes?: Record<string, unknown>;
  data?: Record<string, unknown>;
  setDataResult?: boolean;
}

const createBlock = (options: MockBlockOptions): Block => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');
  // Distinct markup per block: toHaveBeenCalledWith compares DOM nodes
  // structurally, so identical holders would make a wrong-element mutant pass.
  holder.setAttribute('data-test-block', options.id);
  holder.textContent = options.id;

  let contentIds = options.contentIds ?? [];
  const writes: string[][] = [];

  const block = {
    id: options.id,
    holder,
    parentId: options.parentId ?? null,
    name: options.name ?? 'paragraph',
    tool: (options.tool ?? {}) as BlockToolAdapter,
    preservedTunes: options.tunes ?? {},
    preservedData: options.data ?? {},
    data: options.data ?? {},
    inputs: [],
    isEmpty: true,
    settings: {},
    tunes: new ToolsCollection<BlockToolAdapter>(),
    config: {},
    setData: vi.fn(() => Promise.resolve(options.setDataResult ?? true)),
    call: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    destroyEvents: vi.fn(),
  };

  Object.defineProperty(block, 'contentIds', {
    configurable: true,
    enumerable: true,
    get: (): string[] => contentIds,
    set: (next: string[]): void => {
      contentIds = next;
      writes.push([...next]);
    },
  });

  const typed = block as unknown as Block;

  contentIdWrites.set(typed, writes);

  return typed;
};

const writesFor = (block: Block): string[][] => contentIdWrites.get(block) ?? [];

interface YRecordFields {
  type?: unknown;
  data?: Record<string, unknown>;
  tunes?: Record<string, unknown>;
  parentId?: unknown;
  contentIds?: unknown[];
  lastEditedAt?: unknown;
  lastEditedBy?: unknown;
}

interface DocHarness {
  manager: YjsManager;
  put: (id: string, fields: YRecordFields) => YMap<unknown>;
  drop: (id: string) => void;
  setOrder: (ids: string[]) => void;
  getBlockById: ReturnType<typeof vi.fn>;
  addBlock: ReturnType<typeof vi.fn>;
  transactWithoutCapture: ReturnType<typeof vi.fn>;
  orderedIds: ReturnType<typeof vi.fn>;
  destroy: () => void;
}

/**
 * A real Y.Doc behind the YjsManager surface BlockYjsSync consumes: the
 * reconciler narrows records with `instanceof YMap` / `instanceof YArray`, and
 * a hand-rolled stub can be made to answer whatever a test wants.
 */
const createDocHarness = (): DocHarness => {
  const doc = new YDoc();
  const blocksMap = doc.getMap<YMap<unknown>>('blocks');
  let order: string[] = [];

  const put = (id: string, fields: YRecordFields): YMap<unknown> => {
    const record = new YMap<unknown>();

    blocksMap.set(id, record);
    record.set('id', id);

    if ('type' in fields) {
      record.set('type', fields.type);
    }

    const data = new YMap<unknown>();

    record.set('data', data);

    for (const [key, value] of Object.entries(fields.data ?? {})) {
      data.set(key, value);
    }

    if (fields.tunes !== undefined) {
      const tunes = new YMap<unknown>();

      record.set('tunes', tunes);

      for (const [key, value] of Object.entries(fields.tunes)) {
        tunes.set(key, value);
      }
    }

    if ('parentId' in fields) {
      record.set('parentId', fields.parentId);
    }

    if (fields.contentIds !== undefined) {
      const list = new YArray<unknown>();

      record.set('contentIds', list);
      list.push(fields.contentIds);
    }

    if ('lastEditedAt' in fields) {
      record.set('lastEditedAt', fields.lastEditedAt);
    }

    if ('lastEditedBy' in fields) {
      record.set('lastEditedBy', fields.lastEditedBy);
    }

    return record;
  };

  const getBlockById = vi.fn((id: string): YMap<unknown> | undefined => blocksMap.get(id));
  const addBlock = vi.fn();
  const transactWithoutCapture = vi.fn((fn: () => void) => fn());
  const orderedIds = vi.fn((): string[] => [...order]);

  const manager = {
    getBlockById,
    addBlock,
    transactWithoutCapture,
    orderedIds,
    onBlocksChanged: vi.fn(() => vi.fn()),
    yMapToObject: vi.fn((map: YMap<unknown>): Record<string, unknown> => map.toJSON()),
    transact: vi.fn((fn: () => void) => fn()),
    updateBlockData: vi.fn(),
    removeBlock: vi.fn(),
    moveBlock: vi.fn(),
    stopCapturing: vi.fn(),
    toJSON: vi.fn(() => []),
  } as unknown as YjsManager;

  return {
    manager,
    put,
    drop: (id: string): void => {
      blocksMap.delete(id);
    },
    setOrder: (ids: string[]): void => {
      order = [...ids];
    },
    getBlockById,
    addBlock,
    transactWithoutCapture,
    orderedIds,
    destroy: (): void => doc.destroy(),
  };
};

const createFactory = (tools: Record<string, Partial<BlockToolAdapter>>): BlockFactory => {
  const collection = new ToolsCollection<BlockToolAdapter>();

  for (const [name, adapter] of Object.entries(tools)) {
    collection.set(name, adapter as BlockToolAdapter);
  }

  return new BlockFactory(
    {
      API: {} as API,
      eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
      tools: collection,
      moduleInstances: { ReadOnly: { isEnabled: false } } as never,
    },
    vi.fn()
  );
};

interface Harness {
  yjsSync: BlockYjsSync;
  repository: BlockRepository;
  blocksStore: BlocksStore;
  handlers: SyncHandlers;
  factory: BlockFactory;
  doc: DocHarness;
  workingArea: HTMLElement;
  emit: (event: BlockChangeEvent) => void;
  scheduled: Array<() => void>;
  frames: FrameRequestCallback[];
  runScheduled: () => void;
  flushFrames: () => void;
}

interface HarnessOptions {
  blocks: Block[];
  tools?: Record<string, Partial<BlockToolAdapter>>;
  operations?: { suppressStopCapturing: boolean };
  sanitizer?: BlockYjsSyncDependencies['sanitizer'];
}

const createHarness = (options: HarnessOptions): Harness => {
  const workingArea = document.createElement('div');

  document.body.appendChild(workingArea);

  const rawStore = new Blocks(workingArea);

  for (const block of options.blocks) {
    rawStore.push(block);
  }

  const blocksStore = new Proxy(rawStore, {
    set: Blocks.set,
    get: Blocks.get,
  }) as unknown as BlocksStore;

  const repository = new BlockRepository();

  repository.initialize(blocksStore);

  const doc = createDocHarness();
  const factory = createFactory(options.tools ?? { paragraph: {}, header: {}, toggle: {} });

  const handlers: SyncHandlers = {
    getBlockIndex: vi.fn((block: Block) => repository.getBlockIndex(block)),
    insertDefaultBlock: vi.fn(() => createBlock({ id: 'restored-default' })),
    // Minimal shape of the real handler: the reconciler groups and reconciles
    // by `parentId`, so a no-op stub would hide every reparent mutant.
    setBlockParent: vi.fn((child: Block, parentId: string | null) => {
      const target: { parentId: string | null } = child;

      target.parentId = parentId;
    }),
    replaceBlock: vi.fn(),
    onBlockRemoved: vi.fn(),
    onBlockAdded: vi.fn(),
  };

  const dependencies: BlockYjsSyncDependencies = {
    YjsManager: doc.manager,
    operations: options.operations as BlockYjsSyncDependencies['operations'],
    sanitizer: options.sanitizer,
  };

  const yjsSync = new BlockYjsSync(dependencies, repository, factory, handlers, blocksStore);

  const scheduled: Array<() => void> = [];
  const frames: FrameRequestCallback[] = [];

  // Captured, not run: the holder reconcile throws its dev tripwire from inside
  // a microtask, where an `expect(...).toThrow` can never see it.
  vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback: () => void) => {
    scheduled.push(callback);
  });
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
    frames.push(callback);

    return frames.length;
  });

  let callback: (event: BlockChangeEvent) => void = () => undefined;

  const onBlocksChanged = doc.manager.onBlocksChanged as unknown as ReturnType<typeof vi.fn>;

  onBlocksChanged.mockImplementation((cb: (event: BlockChangeEvent) => void) => {
    callback = cb;

    return vi.fn();
  });

  yjsSync.subscribe();

  return {
    yjsSync,
    repository,
    blocksStore,
    handlers,
    factory,
    doc,
    workingArea,
    emit: (event: BlockChangeEvent): void => callback(event),
    scheduled,
    frames,
    runScheduled: (): void => {
      const pending = scheduled.splice(0, scheduled.length);

      for (const task of pending) {
        task();
      }
    },
    flushFrames: (): void => {
      const pending = frames.splice(0, frames.length);

      for (const frame of pending) {
        frame(0);
      }
    },
  };
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
};

const composeSpy = (
  factory: BlockFactory,
  make: (options: ComposeBlockOptions) => Block = (options) =>
    createBlock({ id: options.id ?? 'composed', name: options.tool })
): MockInstance<(options: ComposeBlockOptions) => Block> =>
  vi.spyOn(factory, 'composeBlock').mockImplementation(make);

describe('BlockYjsSync — mutation kills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    document.body.innerHTML = '';
  });

  describe('atomic operation window', () => {
    it('holds stopCapturing suppressed for the whole window and clears it only at the outermost exit', () => {
      const operations = { suppressStopCapturing: false };
      const harness = createHarness({ blocks: [createBlock({ id: 'b1' })], operations });
      const seen: boolean[] = [];

      harness.yjsSync.withAtomicOperation(() => {
        seen.push(operations.suppressStopCapturing);

        harness.yjsSync.withAtomicOperation(() => {
          seen.push(operations.suppressStopCapturing);
        });

        // Inner exit must not release the outer window: a released flag here
        // lets the outer work land as fresh undo steps.
        seen.push(operations.suppressStopCapturing);
      });

      expect(seen).toEqual([true, true, true]);
      expect(operations.suppressStopCapturing).toBe(false);
    });

    it('runs without options and closes the window synchronously', () => {
      const harness = createHarness({ blocks: [createBlock({ id: 'b1' })] });

      expect(() => harness.yjsSync.withAtomicOperation(() => undefined)).not.toThrow();
      expect(harness.yjsSync.isSyncingFromYjs).toBe(false);
      expect(harness.frames).toHaveLength(0);
    });

    it('keeps the window open through the next frame when asked', () => {
      const harness = createHarness({ blocks: [createBlock({ id: 'b1' })] });

      harness.yjsSync.withAtomicOperation(() => undefined, { extendThroughRAF: true });

      expect(harness.yjsSync.isSyncingFromYjs).toBe(true);

      harness.flushFrames();

      expect(harness.yjsSync.isSyncingFromYjs).toBe(false);
    });

    it('rethrows and closes the window when the body throws', () => {
      const operations = { suppressStopCapturing: false };
      const harness = createHarness({ blocks: [createBlock({ id: 'b1' })], operations });

      expect(() =>
        harness.yjsSync.withAtomicOperation(() => {
          throw new Error('boom');
        })
      ).toThrow('boom');
      expect(harness.yjsSync.isSyncingFromYjs).toBe(false);
      expect(operations.suppressStopCapturing).toBe(false);
    });

    it('rethrows and closes the window when an async body rejects', async () => {
      const harness = createHarness({ blocks: [createBlock({ id: 'b1' })] });

      await expect(
        harness.yjsSync.withAtomicOperationAsync(() => Promise.reject(new Error('async boom')))
      ).rejects.toThrow('async boom');
      expect(harness.yjsSync.isSyncingFromYjs).toBe(false);
    });

    it('closes an async window synchronously when no options were given', async () => {
      const harness = createHarness({ blocks: [createBlock({ id: 'b1' })] });

      await harness.yjsSync.withAtomicOperationAsync(() => Promise.resolve());

      expect(harness.yjsSync.isSyncingFromYjs).toBe(false);
      expect(harness.frames).toHaveLength(0);
    });

    it('holds an async window open through the next frame when asked', async () => {
      const harness = createHarness({ blocks: [createBlock({ id: 'b1' })] });

      await harness.yjsSync.withAtomicOperationAsync(() => Promise.resolve(), { extendThroughRAF: true });

      expect(harness.yjsSync.isSyncingFromYjs).toBe(true);

      harness.flushFrames();

      expect(harness.yjsSync.isSyncingFromYjs).toBe(false);
    });

    it('scopes a blockId window to that subtree only', () => {
      const parent = createBlock({ id: 'p' });
      const child = createBlock({ id: 'c', parentId: 'p' });
      const other = createBlock({ id: 'o' });
      const harness = createHarness({ blocks: [parent, child, other] });

      harness.yjsSync.withAtomicOperation(() => {
        expect(harness.yjsSync.isReconciling(child)).toBe(true);
        expect(harness.yjsSync.isReconciling(other)).toBe(false);
      }, { blockId: 'p' });

      expect(harness.yjsSync.isReconciling(parent)).toBe(false);
    });

    it('does not recurse forever when the doc parented two blocks into each other', () => {
      const a = createBlock({ id: 'a', parentId: 'b' });
      const b = createBlock({ id: 'b', parentId: 'a' });
      const harness = createHarness({ blocks: [a, b] });

      // A peer can write a parent cycle; without the visited set the ancestor
      // walk overflows the stack and takes the whole dispatch down.
      harness.yjsSync.withAtomicOperation(() => {
        expect(harness.yjsSync.isReconciling(a)).toBe(false);
      }, { blockId: 'nobody' });
    });

    it('survives destroy() before subscribe()', () => {
      const harness = createHarness({ blocks: [createBlock({ id: 'b1' })] });
      const fresh = new BlockYjsSync(
        { YjsManager: harness.doc.manager },
        harness.repository,
        harness.factory,
        harness.handlers,
        harness.blocksStore
      );

      expect(() => fresh.destroy()).not.toThrow();
    });
  });

  describe('holder reconcile scheduling', () => {
    const twoDrifted = (): Harness => {
      const a = createBlock({ id: 'a-first' });
      const b = createBlock({ id: 'b-second' });
      const harness = createHarness({ blocks: [a, b] });

      harness.workingArea.insertBefore(b.holder, a.holder);

      return harness;
    };

    it('schedules exactly one reconcile per event batch', () => {
      const harness = createHarness({ blocks: [createBlock({ id: 'a' })] });

      harness.emit({ blockId: 'ghost', type: 'update', origin: 'remote' });
      harness.emit({ blockId: 'ghost', type: 'update', origin: 'remote' });

      expect(harness.scheduled).toHaveLength(1);
    });

    it('re-arms the reconcile for the next batch', () => {
      const harness = createHarness({ blocks: [createBlock({ id: 'a' })] });

      harness.emit({ blockId: 'ghost', type: 'update', origin: 'remote' });
      harness.runScheduled();
      harness.emit({ blockId: 'ghost', type: 'update', origin: 'remote' });

      expect(harness.scheduled).toHaveLength(1);
    });

    it('reports a holder that drifted out of array order', () => {
      const harness = twoDrifted();

      harness.emit({ blockId: 'ghost', type: 'update', origin: 'remote' });

      expect(() => harness.runScheduled()).toThrow(
        /Block DOM order diverged from the block array after yjs-sync reconcile/
      );
    });

    it('names both blocks and the parent in the divergence report', () => {
      const harness = twoDrifted();

      harness.emit({ blockId: 'ghost', type: 'update', origin: 'remote' });

      expect(() => harness.runScheduled()).toThrow(/"a-first" must precede "b-second" in the DOM/);
    });

    it('lists every drifted pair on its own line', () => {
      const a = createBlock({ id: 'a-first' });
      const b = createBlock({ id: 'b-second' });
      const c = createBlock({ id: 'c-third' });
      const harness = createHarness({ blocks: [a, b, c] });

      harness.workingArea.replaceChildren(c.holder, b.holder, a.holder);
      harness.emit({ blockId: 'ghost', type: 'update', origin: 'remote' });

      // Two violations: a single-violation report cannot show the separator.
      expect(() => harness.runScheduled()).toThrow(
        /"a-first" must precede "b-second"[^\n]*\n\s+- "b-second" must precede "c-third"/
      );
    });

    it('reports root parentage as "root"', () => {
      const harness = twoDrifted();

      harness.emit({ blockId: 'ghost', type: 'update', origin: 'remote' });

      expect(() => harness.runScheduled()).toThrow(/\(parent: root\)/);
    });

    it('names the container id when the drifted pair is nested', () => {
      const parent = createBlock({ id: 'p', contentIds: ['c-one', 'c-two'] });
      const first = createBlock({ id: 'c-one', parentId: 'p' });
      const second = createBlock({ id: 'c-two', parentId: 'p' });
      const harness = createHarness({ blocks: [parent, first, second] });
      const container = document.createElement('div');

      container.setAttribute('data-blok-toggle-children', '');
      parent.holder.appendChild(container);
      container.appendChild(second.holder);
      container.appendChild(first.holder);

      harness.emit({ blockId: 'ghost', type: 'update', origin: 'remote' });

      expect(() => harness.runScheduled()).toThrow(/\(parent: p\)/);
    });

    it('stays quiet outside test and development builds', () => {
      vi.stubEnv('NODE_ENV', 'production');

      const harness = twoDrifted();

      harness.emit({ blockId: 'ghost', type: 'update', origin: 'remote' });

      expect(() => harness.runScheduled()).not.toThrow();
    });

    it('still trips in a development build', () => {
      vi.stubEnv('NODE_ENV', 'development');

      const harness = twoDrifted();

      harness.emit({ blockId: 'ghost', type: 'update', origin: 'remote' });

      expect(() => harness.runScheduled()).toThrow(/Block DOM order diverged/);
    });

    it('repairs holder order for a remove-driven batch', () => {
      const harness = twoDrifted();
      const [first, second] = harness.repository.blocks;

      harness.emit({ blockId: 'gone', type: 'remove', origin: 'undo' });

      expect(() => harness.runScheduled()).not.toThrow();
      expect([...harness.workingArea.children]).toEqual([first.holder, second.holder]);
    });

    it('does not carry the remove-driven repair into the next batch', () => {
      const a = createBlock({ id: 'a-first' });
      const b = createBlock({ id: 'b-second' });
      const harness = createHarness({ blocks: [a, b] });

      harness.emit({ blockId: 'gone', type: 'remove', origin: 'undo' });
      harness.runScheduled();

      harness.workingArea.insertBefore(b.holder, a.holder);
      harness.emit({ blockId: 'ghost', type: 'update', origin: 'remote' });

      expect(() => harness.runScheduled()).toThrow(/Block DOM order diverged/);
    });

    it('does not repair a group that only an earlier batch reparented into', () => {
      const parent = createBlock({ id: 'p', contentIds: ['c-one', 'c-two'] });
      const first = createBlock({ id: 'c-one' });
      const second = createBlock({ id: 'c-two', parentId: 'p' });
      const harness = createHarness({ blocks: [parent, first, second] });
      const container = document.createElement('div');

      container.setAttribute('data-blok-toggle-children', '');
      parent.holder.appendChild(container);
      container.appendChild(first.holder);
      container.appendChild(second.holder);

      harness.doc.put('c-one', { type: 'paragraph', parentId: 'p' });
      harness.doc.put('p', { type: 'toggle', contentIds: ['c-one', 'c-two'] });
      harness.emit({ blockId: 'c-one', type: 'update', origin: 'remote' });
      harness.runScheduled();
      harness.flushFrames();

      container.insertBefore(second.holder, first.holder);
      harness.emit({ blockId: 'ghost', type: 'update', origin: 'remote' });

      expect(() => harness.runScheduled()).toThrow(/Block DOM order diverged/);
    });

    it('groups siblings by their own parent, not by the root', () => {
      const child = createBlock({ id: 'c', parentId: 'p' });
      const parent = createBlock({ id: 'p', contentIds: ['c'] });
      const harness = createHarness({ blocks: [child, parent] });

      harness.workingArea.insertBefore(parent.holder, child.holder);
      harness.emit({ blockId: 'ghost', type: 'update', origin: 'remote' });

      // Array order is [c, p] but they are not siblings, so their relative DOM
      // order is nobody's business.
      expect(() => harness.runScheduled()).not.toThrow();
    });
  });

  describe('sibling holder repair', () => {
    it('never pulls a holder across a container boundary', () => {
      const a = createBlock({ id: 'a-first' });
      const b = createBlock({ id: 'b-second' });
      const harness = createHarness({ blocks: [a, b] });
      const sideContainer = document.createElement('div');

      sideContainer.setAttribute('data-side', '');
      harness.workingArea.insertBefore(sideContainer, a.holder);
      sideContainer.appendChild(b.holder);

      harness.emit({ blockId: 'gone', type: 'remove', origin: 'undo' });

      expect(() => harness.runScheduled()).not.toThrow();
      expect(b.holder.parentElement).toBe(sideContainer);
    });

    it('leaves an in-order pair alone instead of closing the gap between them', () => {
      const a = createBlock({ id: 'a-first' });
      const b = createBlock({ id: 'b-second' });
      const harness = createHarness({ blocks: [a, b] });
      const spacer = document.createElement('div');

      spacer.setAttribute('data-spacer', '');
      harness.workingArea.insertBefore(spacer, b.holder);

      harness.emit({ blockId: 'gone', type: 'remove', origin: 'undo' });
      harness.runScheduled();

      expect([...harness.workingArea.children]).toEqual([a.holder, spacer, b.holder]);
    });
  });

  describe('remote update — parent mirroring', () => {
    const reparentHarness = (): { harness: Harness; parent: Block; first: Block; second: Block; container: HTMLElement } => {
      const parent = createBlock({ id: 'p', name: 'toggle', contentIds: ['c-two', 'c-one'] });
      const first = createBlock({ id: 'c-one' });
      const second = createBlock({ id: 'c-two', parentId: 'p' });
      const harness = createHarness({ blocks: [parent, first, second] });
      const container = document.createElement('div');

      container.setAttribute('data-blok-toggle-children', '');
      parent.holder.appendChild(container);
      container.appendChild(second.holder);
      container.appendChild(first.holder);

      harness.doc.put('p', { type: 'toggle', contentIds: ['c-one', 'c-two'] });
      harness.doc.put('c-one', { type: 'paragraph', parentId: 'p' });

      return { harness, parent, first, second, container };
    };

    it('mirrors the doc child order onto the parent after a remote reparent', () => {
      const { harness, parent } = reparentHarness();

      harness.emit({ blockId: 'c-one', type: 'update', origin: 'remote' });

      expect(parent.contentIds).toStrictEqual(['c-one', 'c-two']);
    });

    it('repairs the holder order of the group the reparent landed in', () => {
      const { harness, first, second, container } = reparentHarness();

      harness.emit({ blockId: 'c-one', type: 'update', origin: 'remote' });

      expect(() => harness.runScheduled()).not.toThrow();
      expect([...container.children]).toEqual([first.holder, second.holder]);
    });

    it('treats a non-string parentId from the doc as root', () => {
      const child = createBlock({ id: 'c', parentId: 'p' });
      const parent = createBlock({ id: 'p', name: 'toggle' });
      const harness = createHarness({ blocks: [parent, child] });

      harness.doc.put('c', { type: 'paragraph', parentId: 42 });

      harness.emit({ blockId: 'c', type: 'update', origin: 'remote' });

      expect(harness.handlers.setBlockParent).toHaveBeenCalledWith(child, null);
    });

    it('promotes to root when the doc dropped the parentId key', () => {
      const child = createBlock({ id: 'c', parentId: 'p' });
      const parent = createBlock({ id: 'p', name: 'toggle' });
      const harness = createHarness({ blocks: [parent, child] });

      harness.doc.put('c', { type: 'paragraph' });

      harness.emit({ blockId: 'c', type: 'update', origin: 'remote' });

      expect(harness.handlers.setBlockParent).toHaveBeenCalledWith(child, null);
    });

    it('leaves an already-root block untouched when the doc names no parent', () => {
      const child = createBlock({ id: 'c' });
      const harness = createHarness({ blocks: [child] });

      harness.doc.put('c', { type: 'paragraph' });

      harness.emit({ blockId: 'c', type: 'update', origin: 'remote' });

      expect(harness.handlers.setBlockParent).not.toHaveBeenCalled();
    });

    it('repairs the root group after a promotion out of a container', () => {
      const parent = createBlock({ id: 'p', name: 'toggle' });
      const child = createBlock({ id: 'c-two', parentId: 'p' });
      const harness = createHarness({ blocks: [child, parent] });

      harness.workingArea.insertBefore(parent.holder, child.holder);
      harness.doc.put('c-two', { type: 'paragraph' });

      harness.emit({ blockId: 'c-two', type: 'update', origin: 'remote' });

      // Array order is [c-two, p]; the promotion must queue the root group for
      // the holder repair, or the block renders after the container it left.
      expect(() => harness.runScheduled()).not.toThrow();
      expect([...harness.workingArea.children]).toEqual([child.holder, parent.holder]);
    });

    it('warns when the doc places a child a container denies', () => {
      const warn = vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);
      const parent = createBlock({
        id: 'p',
        name: 'toggle',
        tool: { childTools: { allow: ['header'] } },
      });
      const child = createBlock({ id: 'c', name: 'paragraph' });
      const harness = createHarness({ blocks: [parent, child] });

      harness.doc.put('c', { type: 'paragraph', parentId: 'p' });

      harness.emit({ blockId: 'c', type: 'update', origin: 'remote' });

      expect(warn).toHaveBeenCalledWith(expect.stringContaining("childTools does not allow it"), 'warn');
    });

    it('stays quiet when the container allows the child', () => {
      const warn = vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);
      const parent = createBlock({
        id: 'p',
        name: 'toggle',
        tool: { childTools: { allow: ['paragraph'] } },
      });
      const child = createBlock({ id: 'c', name: 'paragraph' });
      const harness = createHarness({ blocks: [parent, child] });

      harness.doc.put('c', { type: 'paragraph', parentId: 'p' });

      harness.emit({ blockId: 'c', type: 'update', origin: 'remote' });

      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('remote update — guards and rematerialisation', () => {
    it('ignores an update for a block memory does not hold', () => {
      const harness = createHarness({ blocks: [createBlock({ id: 'a' })] });

      harness.doc.put('ghost', { type: 'paragraph' });

      expect(() => harness.emit({ blockId: 'ghost', type: 'update', origin: 'remote' })).not.toThrow();
      expect(harness.handlers.setBlockParent).not.toHaveBeenCalled();
    });

    it('ignores an update for a block the doc does not hold', () => {
      const block = createBlock({ id: 'a' });
      const harness = createHarness({ blocks: [block] });

      expect(() => harness.emit({ blockId: 'a', type: 'update', origin: 'remote' })).not.toThrow();
      expect(block.setData).not.toHaveBeenCalled();
    });

    it('recreates the block when the doc names a different tool', () => {
      const block = createBlock({ id: 'a', name: 'paragraph' });
      const harness = createHarness({ blocks: [block] });
      const spy = composeSpy(harness.factory);

      harness.doc.put('a', { type: 'header', data: { text: 'hi' } });

      harness.emit({ blockId: 'a', type: 'update', origin: 'remote' });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0].tool).toBe('header');
      expect(block.setData).not.toHaveBeenCalled();
      expect(harness.handlers.replaceBlock).toHaveBeenCalledTimes(1);
    });

    it('keeps the stale view when the doc names a tool this client lacks', () => {
      const warn = vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);
      const block = createBlock({ id: 'a', name: 'paragraph' });
      const harness = createHarness({ blocks: [block] });
      const spy = composeSpy(harness.factory);

      harness.doc.put('a', { type: 'exotic', data: { text: 'hi' } });

      expect(() => harness.emit({ blockId: 'a', type: 'update', origin: 'remote' })).not.toThrow();
      expect(spy).not.toHaveBeenCalled();
      expect(harness.handlers.replaceBlock).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('«exotic»'), 'warn');
    });

    it('keeps the recreate window open through the next frame, scoped to that block', () => {
      const block = createBlock({ id: 'a', name: 'paragraph' });
      const other = createBlock({ id: 'other' });
      const harness = createHarness({ blocks: [block, other] });
      const scopes: boolean[] = [];

      composeSpy(harness.factory, (options) => {
        scopes.push(harness.yjsSync.isReconciling(other));

        return createBlock({ id: options.id ?? 'composed', name: options.tool });
      });

      harness.doc.put('a', { type: 'header' });

      harness.emit({ blockId: 'a', type: 'update', origin: 'remote' });

      expect(scopes).toEqual([false]);
      expect(harness.yjsSync.isSyncingFromYjs).toBe(true);

      harness.flushFrames();

      expect(harness.yjsSync.isSyncingFromYjs).toBe(false);
    });

    it('recreates the block when the doc changed its tunes', () => {
      const block = createBlock({ id: 'a', name: 'paragraph', tunes: { align: 'left' } });
      const harness = createHarness({ blocks: [block] });
      const spy = composeSpy(harness.factory);

      harness.doc.put('a', { type: 'paragraph', tunes: { align: 'right' } });

      harness.emit({ blockId: 'a', type: 'update', origin: 'remote' });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0].tunes).toStrictEqual({ align: 'right' });
    });

    it('carries the doc data into setData when only data changed', async () => {
      const block = createBlock({ id: 'a', name: 'paragraph' });
      const harness = createHarness({ blocks: [block] });

      harness.doc.put('a', { type: 'paragraph', data: { text: 'from peer' } });

      harness.emit({ blockId: 'a', type: 'update', origin: 'remote' });
      await flush();

      expect(block.setData).toHaveBeenCalledWith({ text: 'from peer' });
    });

    it('does not compose a replacement once the block left the store', async () => {
      const block = createBlock({ id: 'a', name: 'paragraph', setDataResult: false });
      const harness = createHarness({ blocks: [block] });
      const spy = composeSpy(harness.factory);

      harness.doc.put('a', { type: 'paragraph', data: { text: 'x' } });
      (harness.handlers.getBlockIndex as unknown as ReturnType<typeof vi.fn>).mockReturnValue(-1);

      harness.emit({ blockId: 'a', type: 'update', origin: 'remote' });
      await flush();

      expect(spy).not.toHaveBeenCalled();
      expect(harness.handlers.replaceBlock).not.toHaveBeenCalled();
    });

    it('does not replace into a slot another block already took', async () => {
      const block = createBlock({ id: 'a', name: 'paragraph' });
      const harness = createHarness({ blocks: [block] });
      let settle: (accepted: boolean) => void = () => undefined;

      (block.setData as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise<boolean>((resolve) => {
          settle = resolve;
        })
      );

      const spy = composeSpy(harness.factory);

      harness.doc.put('a', { type: 'paragraph', data: { text: 'x' } });
      harness.emit({ blockId: 'a', type: 'update', origin: 'remote' });
      await flush();

      // A remove + re-add lands while setData is still pending, so the id now
      // names a different instance than the one being replaced.
      harness.blocksStore.remove(0);
      harness.blocksStore.push(createBlock({ id: 'a' }));
      (harness.handlers.getBlockIndex as unknown as ReturnType<typeof vi.fn>).mockReturnValue(0);

      settle(false);
      await flush();

      expect(spy).not.toHaveBeenCalled();
      expect(harness.handlers.replaceBlock).not.toHaveBeenCalled();
    });

    it('omits contentIds for a childless block instead of sending an empty list', async () => {
      const block = createBlock({ id: 'a', name: 'paragraph', setDataResult: false });
      const harness = createHarness({ blocks: [block] });
      const spy = composeSpy(harness.factory);

      harness.doc.put('a', { type: 'paragraph', data: { text: 'x' } });

      harness.emit({ blockId: 'a', type: 'update', origin: 'remote' });
      await flush();

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0].contentIds).toBeUndefined();
    });

    it('re-runs rendered() on the replacement when children were re-homed into it', async () => {
      const block = createBlock({ id: 'a', name: 'paragraph', setDataResult: false });
      const orphan = createBlock({ id: 'orphan', parentId: 'someone-else' });
      const harness = createHarness({ blocks: [block, orphan] });
      const replacement = createBlock({ id: 'a', name: 'paragraph' });

      composeSpy(harness.factory, () => replacement);

      harness.doc.put('a', { type: 'paragraph', data: { text: 'x' }, contentIds: ['orphan'] });
      harness.doc.put('orphan', { type: 'paragraph', parentId: 'a' });

      harness.emit({ blockId: 'a', type: 'update', origin: 'remote' });
      await flush();

      expect(harness.handlers.setBlockParent).toHaveBeenCalledWith(orphan, 'a');
      expect(replacement.call).toHaveBeenCalledWith(BlockToolAPI.RENDERED);
    });

    it('does not re-run rendered() when nothing was re-homed', async () => {
      const block = createBlock({ id: 'a', name: 'paragraph', setDataResult: false });
      const harness = createHarness({ blocks: [block] });
      const replacement = createBlock({ id: 'a', name: 'paragraph' });

      composeSpy(harness.factory, () => replacement);

      // An EMPTY contentIds list, not a missing one: a missing list returns
      // before the "were any re-homed" answer is even computed.
      harness.doc.put('a', { type: 'paragraph', data: { text: 'x' }, contentIds: [] });

      harness.emit({ blockId: 'a', type: 'update', origin: 'remote' });
      await flush();

      expect(replacement.call).not.toHaveBeenCalled();
    });
  });

  describe('record narrowing', () => {
    it('carries the doc edit stamps onto the materialised block', () => {
      const harness = createHarness({ blocks: [createBlock({ id: 'a' })] });
      const spy = composeSpy(harness.factory);

      harness.doc.put('new', {
        type: 'paragraph',
        lastEditedAt: 1717171717,
        lastEditedBy: 'user-7',
      });
      harness.doc.setOrder(['a', 'new']);

      harness.emit({ blockId: 'new', type: 'add', origin: 'remote' });

      expect(spy.mock.calls[0][0].lastEditedAt).toBe(1717171717);
      expect(spy.mock.calls[0][0].lastEditedBy).toBe('user-7');
    });

    it('drops non-numeric and non-string edit stamps from the doc', () => {
      const harness = createHarness({ blocks: [createBlock({ id: 'a' })] });
      const spy = composeSpy(harness.factory);

      harness.doc.put('new', {
        type: 'paragraph',
        lastEditedAt: 'yesterday',
        lastEditedBy: 42,
      });
      harness.doc.setOrder(['a', 'new']);

      harness.emit({ blockId: 'new', type: 'add', origin: 'remote' });

      expect(spy.mock.calls[0][0].lastEditedAt).toBeUndefined();
      expect(spy.mock.calls[0][0].lastEditedBy).toBeNull();
    });

    it('refuses a non-string parentId from the doc when materialising', () => {
      const harness = createHarness({ blocks: [createBlock({ id: 'a' })] });
      const spy = composeSpy(harness.factory);

      harness.doc.put('new', { type: 'paragraph', parentId: 7 });
      harness.doc.setOrder(['a', 'new']);

      harness.emit({ blockId: 'new', type: 'add', origin: 'remote' });

      expect(spy.mock.calls[0][0].parentId).toBeUndefined();
      expect(harness.handlers.setBlockParent).not.toHaveBeenCalled();
    });
  });

  describe('remote add', () => {
    it('places the new block at its memory index, not its doc index', () => {
      const existing = createBlock({ id: 'a' });
      const harness = createHarness({ blocks: [existing] });
      const created = createBlock({ id: 'new' });

      composeSpy(harness.factory, () => created);

      harness.doc.put('new', { type: 'paragraph' });
      // `unknown-tool` is doc-only: it must not shift the insert index.
      harness.doc.setOrder(['unknown-tool', 'a', 'new']);

      harness.emit({ blockId: 'new', type: 'add', origin: 'remote' });

      expect(harness.handlers.onBlockAdded).toHaveBeenCalledWith(created, 1);
      expect(harness.repository.blocks.map((block) => block.id)).toEqual(['a', 'new']);
    });

    it('composes the block as a replay with events bound immediately', () => {
      const harness = createHarness({ blocks: [createBlock({ id: 'a' })] });
      const spy = composeSpy(harness.factory);

      harness.doc.put('new', { type: 'paragraph' });
      harness.doc.setOrder(['a', 'new']);

      harness.emit({ blockId: 'new', type: 'add', origin: 'remote' });

      expect(spy.mock.calls[0][0].origin).toBe('replay');
      expect(spy.mock.calls[0][0].bindEventsImmediately).toBe(true);
    });

    it('ignores an add for a block already in memory', () => {
      const existing = createBlock({ id: 'a' });
      const harness = createHarness({ blocks: [existing] });
      const spy = composeSpy(harness.factory);

      harness.doc.put('a', { type: 'paragraph' });
      harness.doc.setOrder(['a']);

      harness.emit({ blockId: 'a', type: 'add', origin: 'remote' });

      expect(spy).not.toHaveBeenCalled();
      expect(harness.blocksStore.length).toBe(1);
    });

    it('ignores an add the doc has no record for', () => {
      const harness = createHarness({ blocks: [createBlock({ id: 'a' })] });
      const spy = composeSpy(harness.factory);

      harness.doc.setOrder(['a', 'new']);

      expect(() => harness.emit({ blockId: 'new', type: 'add', origin: 'remote' })).not.toThrow();
      expect(spy).not.toHaveBeenCalled();
    });

    it('ignores an add whose tool this client lacks', () => {
      vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const harness = createHarness({ blocks: [createBlock({ id: 'a' })] });
      const spy = composeSpy(harness.factory);

      harness.doc.put('new', { type: 'exotic' });
      harness.doc.setOrder(['a', 'new']);

      expect(() => harness.emit({ blockId: 'new', type: 'add', origin: 'remote' })).not.toThrow();
      expect(spy).not.toHaveBeenCalled();
    });

    it('ignores an add the doc order does not carry', () => {
      const harness = createHarness({ blocks: [createBlock({ id: 'a' })] });
      const spy = composeSpy(harness.factory);

      harness.doc.put('new', { type: 'paragraph' });
      harness.doc.setOrder(['a']);

      harness.emit({ blockId: 'new', type: 'add', origin: 'remote' });

      expect(spy).not.toHaveBeenCalled();
      expect(harness.handlers.onBlockAdded).not.toHaveBeenCalled();
    });

    it('mirrors the doc child order onto the parent it was added under', () => {
      const parent = createBlock({ id: 'p', name: 'toggle', contentIds: ['old', 'new'] });
      const old = createBlock({ id: 'old', parentId: 'p' });
      const harness = createHarness({ blocks: [parent, old] });
      const created = createBlock({ id: 'new', parentId: 'p' });

      composeSpy(harness.factory, () => created);

      harness.doc.put('p', { type: 'toggle', contentIds: ['new', 'old'] });
      harness.doc.put('new', { type: 'paragraph', parentId: 'p' });
      harness.doc.setOrder(['p', 'new', 'old']);

      harness.emit({ blockId: 'new', type: 'add', origin: 'remote' });

      expect(parent.contentIds).toStrictEqual(['new', 'old']);
    });

    it('holds the add window open through the next frame', () => {
      const harness = createHarness({ blocks: [createBlock({ id: 'a' })] });

      composeSpy(harness.factory);
      harness.doc.put('new', { type: 'paragraph' });
      harness.doc.setOrder(['a', 'new']);

      harness.emit({ blockId: 'new', type: 'add', origin: 'remote' });

      expect(harness.yjsSync.isSyncingFromYjs).toBe(true);

      harness.flushFrames();

      expect(harness.yjsSync.isSyncingFromYjs).toBe(false);
    });
  });

  describe('doc child order reconcile', () => {
    const orderHarness = (docOrder: unknown[], memoryOrder: string[]): { harness: Harness; parent: Block } => {
      const parent = createBlock({ id: 'p', name: 'toggle', contentIds: memoryOrder });
      const child = createBlock({ id: 'moving' });
      const harness = createHarness({ blocks: [parent, child] });

      harness.doc.put('p', { type: 'toggle', contentIds: docOrder });
      harness.doc.put('moving', { type: 'paragraph', parentId: 'p' });

      return { harness, parent };
    };

    const reconcile = (harness: Harness): void => {
      harness.emit({ blockId: 'moving', type: 'update', origin: 'remote' });
    };

    it('reorders the parent to the doc order, keeping ids the doc has not caught up with', () => {
      const { harness, parent } = orderHarness(['c3', 'c1', 'not-in-memory'], ['c1', 'c2', 'c3']);

      reconcile(harness);

      expect(parent.contentIds).toStrictEqual(['c3', 'c1', 'c2']);
    });

    it('rewrites the parent when only a later slot moved', () => {
      const { harness, parent } = orderHarness(['c1', 'c3'], ['c1', 'c2', 'c3']);

      reconcile(harness);

      expect(parent.contentIds).toStrictEqual(['c1', 'c3', 'c2']);
    });

    it('leaves the parent list untouched when the doc agrees with memory', () => {
      const { harness, parent } = orderHarness(['c1', 'c2'], ['c1', 'c2']);

      reconcile(harness);

      expect(writesFor(parent)).toEqual([]);
    });

    it('drops non-string entries the doc carries', () => {
      const { harness, parent } = orderHarness([7, 'c2', 'c1'], ['c1', 'c2']);

      reconcile(harness);

      expect(parent.contentIds).toStrictEqual(['c2', 'c1']);
    });

    it('does not reorder when the doc has no contentIds for the parent', () => {
      const parent = createBlock({ id: 'p', name: 'toggle', contentIds: ['c1', 'c2'] });
      const child = createBlock({ id: 'moving' });
      const harness = createHarness({ blocks: [parent, child] });

      harness.doc.put('p', { type: 'toggle' });
      harness.doc.put('moving', { type: 'paragraph', parentId: 'p' });

      reconcile(harness);

      expect(writesFor(parent)).toEqual([]);
    });

    it('does not look the root up as if it were a block', () => {
      const child = createBlock({ id: 'moving', parentId: 'p' });
      const harness = createHarness({ blocks: [child] });
      const lookup = vi.spyOn(harness.repository, 'getBlockById');

      harness.doc.put('moving', { type: 'paragraph', parentId: null });

      harness.emit({ blockId: 'moving', type: 'update', origin: 'remote' });

      expect(lookup).toHaveBeenCalledWith('moving');
      expect(harness.doc.getBlockById).not.toHaveBeenCalledWith(null);
      expect(lookup).not.toHaveBeenCalledWith(null);
    });

    it('survives a reparent onto a container memory does not hold yet', () => {
      const child = createBlock({ id: 'moving' });
      const harness = createHarness({ blocks: [child] });

      harness.doc.put('p', { type: 'toggle', contentIds: ['moving'] });
      harness.doc.put('moving', { type: 'paragraph', parentId: 'p' });

      expect(() => harness.emit({ blockId: 'moving', type: 'update', origin: 'remote' })).not.toThrow();
    });
  });

  describe('orphaned children', () => {
    const orphanHarness = (): { harness: Harness; restored: Block; orphan: Block; settled: Block } => {
      const restored = createBlock({ id: 'r', name: 'toggle', contentIds: ['settled', 'orphan'] });
      const orphan = createBlock({ id: 'orphan', parentId: 'stale-parent' });
      const settled = createBlock({ id: 'settled', parentId: 'r' });
      const harness = createHarness({ blocks: [restored, orphan, settled] });

      harness.doc.put('r', { type: 'toggle', contentIds: ['orphan', 'settled'] });
      harness.doc.put('orphan', { type: 'paragraph', parentId: 'r' });
      harness.doc.put('settled', { type: 'paragraph', parentId: 'r' });
      harness.doc.setOrder(['r', 'orphan', 'settled']);

      return { harness, restored, orphan, settled };
    };

    const rematerialise = async (harness: Harness, replacement: Block): Promise<void> => {
      const target = harness.repository.getBlockById('r');

      if (target !== undefined) {
        (target.setData as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      }

      composeSpy(harness.factory, () => replacement);
      harness.emit({ blockId: 'r', type: 'update', origin: 'remote' });
      await flush();
    };

    it('re-homes only the child the doc says belongs here', async () => {
      const { harness, orphan, settled } = orphanHarness();
      const stray = createBlock({ id: 'stray', parentId: 'elsewhere' });

      harness.blocksStore.push(stray);
      harness.doc.put('stray', { type: 'paragraph', parentId: 'elsewhere' });
      // Named by the container but parented elsewhere in the doc: re-homing it
      // would drag another container's block into this one.
      harness.doc.put('r', { type: 'toggle', contentIds: ['orphan', 'settled', 'stray'] });

      const replacement = createBlock({ id: 'r', name: 'toggle' });

      await rematerialise(harness, replacement);

      expect(harness.handlers.setBlockParent).toHaveBeenCalledTimes(1);
      expect(harness.handlers.setBlockParent).toHaveBeenCalledWith(orphan, 'r');
      expect(settled.parentId).toBe('r');
    });

    it('ignores contentIds entries memory does not hold', async () => {
      const { harness } = orphanHarness();

      harness.doc.put('r', { type: 'toggle', contentIds: ['orphan', 'settled', 'never-loaded'] });

      const replacement = createBlock({ id: 'r', name: 'toggle' });

      await expect(rematerialise(harness, replacement)).resolves.toBeUndefined();
      expect(harness.handlers.setBlockParent).toHaveBeenCalledTimes(1);
    });

    it('ignores a child the doc lost the record for', () => {
      const orphan = createBlock({ id: 'orphan', parentId: 'stale-parent' });
      const harness = createHarness({ blocks: [orphan] });

      composeSpy(harness.factory, () => createBlock({ id: 'r', name: 'toggle' }));
      harness.doc.put('r', { type: 'toggle', contentIds: ['orphan'] });
      harness.doc.setOrder(['orphan', 'r']);

      expect(() => harness.emit({ blockId: 'r', type: 'add', origin: 'remote' })).not.toThrow();
      expect(harness.handlers.setBlockParent).not.toHaveBeenCalled();
    });

    it('survives the doc dropping the record between the read and the reconcile', () => {
      const harness = createHarness({ blocks: [createBlock({ id: 'a' })] });
      const record = harness.doc.put('r', { type: 'toggle', contentIds: [] });

      composeSpy(harness.factory, () => createBlock({ id: 'r', name: 'toggle' }));
      harness.doc.setOrder(['a', 'r']);

      let reads = 0;

      // A peer's remove lands after the add read the record and before its
      // children are reconciled.
      harness.doc.getBlockById.mockImplementation((id: string) => {
        if (id !== 'r') {
          return undefined;
        }

        reads += 1;

        return reads === 1 ? record : undefined;
      });

      expect(() => harness.emit({ blockId: 'r', type: 'add', origin: 'remote' })).not.toThrow();
    });

    it('mirrors the doc sibling order after re-homing', async () => {
      const { harness, restored } = orphanHarness();
      const replacement = createBlock({ id: 'r', name: 'toggle' });

      await rematerialise(harness, replacement);

      expect(restored.contentIds).toStrictEqual(['orphan', 'settled']);
    });

    it('leaves the sibling order alone when nothing was re-homed', async () => {
      const restored = createBlock({ id: 'r', name: 'toggle', contentIds: ['settled', 'other'] });
      const settled = createBlock({ id: 'settled', parentId: 'r' });
      const other = createBlock({ id: 'other', parentId: 'r' });
      const harness = createHarness({ blocks: [restored, settled, other] });

      harness.doc.put('r', { type: 'toggle', contentIds: ['other', 'settled'] });
      harness.doc.put('settled', { type: 'paragraph', parentId: 'r' });
      harness.doc.put('other', { type: 'paragraph', parentId: 'r' });

      const replacement = createBlock({ id: 'r', name: 'toggle' });

      await rematerialise(harness, replacement);

      expect(writesFor(restored)).toEqual([]);
    });
  });

  describe('batch add', () => {
    const batchHarness = (): Harness => {
      const harness = createHarness({ blocks: [createBlock({ id: 'anchor' })] });

      harness.doc.put('one', { type: 'paragraph' });
      harness.doc.put('two', { type: 'paragraph' });
      harness.doc.put('three', { type: 'paragraph' });
      harness.doc.setOrder(['anchor', 'one', 'two', 'three']);

      return harness;
    };

    it('creates the batch in document order whatever order the events arrived in', () => {
      const harness = batchHarness();
      const made: string[] = [];

      composeSpy(harness.factory, (options) => {
        const id = options.id ?? 'composed';

        made.push(id);

        return createBlock({ id });
      });

      // Not descending: a comparator that merely reverses its input would pass
      // on a reversed list.
      harness.emit({ blockIds: ['one', 'three', 'two'], type: 'batch-add', origin: 'redo' });

      expect(made).toEqual(['one', 'two', 'three']);
      expect(harness.repository.blocks.map((block) => block.id)).toEqual(['anchor', 'one', 'two', 'three']);
    });

    it('composes every batch member as a replay with events bound immediately', () => {
      const harness = batchHarness();
      const spy = composeSpy(harness.factory);

      harness.emit({ blockIds: ['one'], type: 'batch-add', origin: 'redo' });

      expect(spy.mock.calls[0][0].origin).toBe('replay');
      expect(spy.mock.calls[0][0].bindEventsImmediately).toBe(true);
    });

    it('keeps the rest of the batch when one member names an unknown tool', () => {
      vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const harness = batchHarness();

      harness.doc.put('two', { type: 'exotic' });

      const made: string[] = [];

      composeSpy(harness.factory, (options) => {
        const id = options.id ?? 'composed';

        made.push(id);

        return createBlock({ id });
      });

      expect(() =>
        harness.emit({ blockIds: ['one', 'two', 'three'], type: 'batch-add', origin: 'redo' })
      ).not.toThrow();
      expect(made).toEqual(['one', 'three']);
    });

    it('skips a batch member the doc has no record for', () => {
      const harness = batchHarness();
      const spy = composeSpy(harness.factory);

      harness.doc.drop('two');

      expect(() =>
        harness.emit({ blockIds: ['two'], type: 'batch-add', origin: 'redo' })
      ).not.toThrow();
      expect(spy).not.toHaveBeenCalled();
    });

    it('opens no sync window when the batch has nothing left to create', () => {
      const harness = batchHarness();

      harness.emit({ blockIds: ['anchor'], type: 'batch-add', origin: 'redo' });

      expect(harness.frames).toHaveLength(0);
      expect(harness.yjsSync.isSyncingFromYjs).toBe(false);
    });

    it('holds the batch window open through the next frame', () => {
      const harness = batchHarness();

      composeSpy(harness.factory);
      harness.emit({ blockIds: ['one'], type: 'batch-add', origin: 'redo' });

      expect(harness.yjsSync.isSyncingFromYjs).toBe(true);

      harness.flushFrames();

      expect(harness.yjsSync.isSyncingFromYjs).toBe(false);
    });

    it('does not reparent a root-level batch member', () => {
      const harness = batchHarness();

      composeSpy(harness.factory);
      harness.emit({ blockIds: ['one'], type: 'batch-add', origin: 'redo' });

      expect(harness.handlers.setBlockParent).not.toHaveBeenCalled();
    });

    it('mirrors the doc child order onto the container a batch landed in', () => {
      const parent = createBlock({ id: 'p', name: 'toggle', contentIds: ['old', 'one'] });
      const old = createBlock({ id: 'old', parentId: 'p' });
      const harness = createHarness({ blocks: [parent, old] });
      const created = createBlock({ id: 'one', parentId: 'p' });

      composeSpy(harness.factory, () => created);

      harness.doc.put('p', { type: 'toggle', contentIds: ['one', 'old'] });
      harness.doc.put('one', { type: 'paragraph', parentId: 'p' });
      harness.doc.setOrder(['p', 'one', 'old']);

      harness.emit({ blockIds: ['one'], type: 'batch-add', origin: 'redo' });

      expect(harness.handlers.setBlockParent).toHaveBeenCalledWith(created, 'p');
      expect(parent.contentIds).toStrictEqual(['one', 'old']);
    });

    it('warns when a batch member lands under a container that denies it', () => {
      const warn = vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);
      const parent = createBlock({
        id: 'p',
        name: 'toggle',
        contentIds: ['one'],
        tool: { childTools: { deny: ['paragraph'] } },
      });
      const harness = createHarness({ blocks: [parent] });

      composeSpy(harness.factory, () => createBlock({ id: 'one', parentId: 'p' }));

      harness.doc.put('p', { type: 'toggle', contentIds: ['one'] });
      harness.doc.put('one', { type: 'paragraph', parentId: 'p' });
      harness.doc.setOrder(['p', 'one']);

      harness.emit({ blockIds: ['one'], type: 'batch-add', origin: 'redo' });

      expect(warn).toHaveBeenCalledWith(expect.stringContaining("childTools does not allow it"), 'warn');
    });
  });

  describe('remote remove', () => {
    it('ignores a remove for a block that is not in the array', () => {
      const block = createBlock({ id: 'a' });
      const harness = createHarness({ blocks: [block] });

      (harness.handlers.getBlockIndex as unknown as ReturnType<typeof vi.fn>).mockReturnValue(-1);

      harness.emit({ blockId: 'a', type: 'remove', origin: 'undo' });

      expect(harness.handlers.onBlockRemoved).not.toHaveBeenCalled();
      expect(harness.blocksStore.length).toBe(1);
    });

    it('drops only the removed id from its container', () => {
      const parent = createBlock({ id: 'p', name: 'toggle', contentIds: ['gone', 'kept'] });
      const gone = createBlock({ id: 'gone', parentId: 'p' });
      const kept = createBlock({ id: 'kept', parentId: 'p' });
      const harness = createHarness({ blocks: [parent, gone, kept] });

      harness.emit({ blockId: 'gone', type: 'remove', origin: 'undo' });

      expect(parent.contentIds).toStrictEqual(['kept']);
    });

    it('survives a removed child whose container is no longer in memory', () => {
      const gone = createBlock({ id: 'gone', parentId: 'vanished' });
      const harness = createHarness({ blocks: [gone] });

      harness.doc.setOrder(['gone']);

      expect(() => harness.emit({ blockId: 'gone', type: 'remove', origin: 'undo' })).not.toThrow();
    });

    it('survives a contentIds entry memory does not hold', () => {
      const parent = createBlock({ id: 'p', name: 'toggle', contentIds: ['never-loaded'] });
      const harness = createHarness({ blocks: [parent] });

      harness.doc.setOrder(['p']);

      expect(() => harness.emit({ blockId: 'p', type: 'remove', origin: 'undo' })).not.toThrow();
    });

    it('survives a child holder that is not attached anywhere', () => {
      const parent = createBlock({ id: 'p', name: 'toggle', contentIds: ['detached'] });
      const detached = createBlock({ id: 'detached', parentId: 'p' });
      const harness = createHarness({ blocks: [parent, detached] });

      detached.holder.remove();
      harness.doc.setOrder(['p']);

      expect(() => harness.emit({ blockId: 'p', type: 'remove', origin: 'undo' })).not.toThrow();
      expect(detached.parentId).toBeNull();
    });

    const liftHarness = (containerAttribute: string, nest = false): { harness: Harness; parent: Block; child: Block } => {
      const parent = createBlock({ id: 'p', name: 'toggle', contentIds: ['child'] });
      const child = createBlock({ id: 'child', parentId: 'p' });
      const harness = createHarness({ blocks: [parent, child] });
      const container = document.createElement('div');

      container.setAttribute(containerAttribute, '');

      if (nest) {
        const column = document.createElement('div');

        column.setAttribute('data-blok-column', '');
        parent.holder.appendChild(column);
        column.appendChild(container);
      } else {
        parent.holder.appendChild(container);
      }

      container.appendChild(child.holder);
      harness.doc.setOrder(['p']);

      return { harness, parent, child };
    };

    it('lifts a toggle-body child out before the container holder is destroyed', () => {
      const { harness, parent, child } = liftHarness('data-blok-toggle-children');

      harness.emit({ blockId: 'p', type: 'remove', origin: 'undo' });

      expect(parent.holder.contains(child.holder)).toBe(false);
      expect(harness.workingArea.contains(child.holder)).toBe(true);
    });

    it('lifts a body child the stray sweep cannot reach', () => {
      const parent = createBlock({ id: 'p', name: 'toggle', contentIds: ['child'] });
      const selfManaged = createBlock({ id: 'self-managed' });
      const child = createBlock({ id: 'child', parentId: 'p' });
      const harness = createHarness({ blocks: [parent, selfManaged, child] });
      const cell = document.createElement('div');
      const body = document.createElement('div');

      // The stray sweep skips `self-managed` (its immediate container is a
      // cell) and would never reach `child` nested inside it, so only the
      // contentIds lift can save this holder.
      cell.setAttribute('data-blok-table-cell-blocks', '');
      body.setAttribute('data-blok-toggle-children', '');
      parent.holder.appendChild(cell);
      cell.appendChild(selfManaged.holder);
      selfManaged.holder.appendChild(body);
      body.appendChild(child.holder);
      harness.doc.setOrder(['p']);

      harness.emit({ blockId: 'p', type: 'remove', origin: 'undo' });

      expect(harness.workingArea.contains(child.holder)).toBe(true);
      expect(parent.holder.contains(child.holder)).toBe(false);
    });

    it('lifts a column out of a columns row', () => {
      const { harness, parent, child } = liftHarness('data-blok-columns');

      harness.emit({ blockId: 'p', type: 'remove', origin: 'undo' });

      expect(parent.holder.contains(child.holder)).toBe(false);
      expect(harness.workingArea.contains(child.holder)).toBe(true);
    });

    it('lifts a leaf out of a column body', () => {
      const { harness, parent, child } = liftHarness('data-blok-column-body', true);

      harness.emit({ blockId: 'p', type: 'remove', origin: 'undo' });

      expect(parent.holder.contains(child.holder)).toBe(false);
      expect(harness.workingArea.contains(child.holder)).toBe(true);
    });

    it('leaves a self-managed cell child nested', () => {
      const { harness, child } = liftHarness('data-blok-table-cell-blocks');
      const cell = child.holder.parentElement;

      harness.emit({ blockId: 'p', type: 'remove', origin: 'undo' });

      expect(child.holder.parentElement).toBe(cell);
      expect(harness.workingArea.contains(child.holder)).toBe(false);
    });

    it('does not touch child holders when the removed holder is already detached', () => {
      const { harness, parent, child } = liftHarness('data-blok-toggle-children');
      const container = child.holder.parentElement;

      parent.holder.remove();

      harness.emit({ blockId: 'p', type: 'remove', origin: 'undo' });

      expect(child.holder.parentElement).toBe(container);
    });

    it('lifts a surviving stray the model no longer links to the removed block', () => {
      const parent = createBlock({ id: 'p', name: 'toggle' });
      const stray = createBlock({ id: 'stray' });
      const harness = createHarness({ blocks: [parent, stray] });
      const container = document.createElement('div');

      container.setAttribute('data-blok-toggle-children', '');
      parent.holder.appendChild(container);
      container.appendChild(stray.holder);
      harness.doc.setOrder(['p']);

      harness.emit({ blockId: 'p', type: 'remove', origin: 'undo' });

      expect(harness.workingArea.contains(stray.holder)).toBe(true);
    });

    it('does not count the removed block as its own stray', () => {
      const parent = createBlock({ id: 'p', name: 'toggle' });
      const stray = createBlock({ id: 'stray' });
      const harness = createHarness({ blocks: [parent, stray] });
      const outerBody = document.createElement('div');
      const innerBody = document.createElement('div');

      // The removed holder sits in a liftable container itself, so counting it
      // among the strays makes the real survivor look nested and skips it.
      outerBody.setAttribute('data-blok-toggle-children', '');
      innerBody.setAttribute('data-blok-toggle-children', '');
      harness.workingArea.appendChild(outerBody);
      outerBody.appendChild(parent.holder);
      parent.holder.appendChild(innerBody);
      innerBody.appendChild(stray.holder);
      harness.doc.setOrder(['p']);

      harness.emit({ blockId: 'p', type: 'remove', origin: 'undo' });

      expect(outerBody.contains(stray.holder)).toBe(true);
      expect(parent.holder.contains(stray.holder)).toBe(false);
    });

    it('lifts only the outermost stray, keeping a nested survivor inside it', () => {
      const parent = createBlock({ id: 'p', name: 'toggle' });
      const outer = createBlock({ id: 'outer' });
      const inner = createBlock({ id: 'inner' });
      const harness = createHarness({ blocks: [parent, outer, inner] });
      const container = document.createElement('div');
      const outerBody = document.createElement('div');

      container.setAttribute('data-blok-toggle-children', '');
      outerBody.setAttribute('data-blok-toggle-children', '');
      parent.holder.appendChild(container);
      container.appendChild(outer.holder);
      outer.holder.appendChild(outerBody);
      outerBody.appendChild(inner.holder);
      harness.doc.setOrder(['p']);

      harness.emit({ blockId: 'p', type: 'remove', origin: 'undo' });

      expect(harness.workingArea.contains(outer.holder)).toBe(true);
      expect(outerBody.contains(inner.holder)).toBe(true);
    });

    it('never lifts a block that was outside the removed subtree', () => {
      const parent = createBlock({ id: 'p', name: 'toggle' });
      const outsider = createBlock({ id: 'outsider' });
      const harness = createHarness({ blocks: [parent, outsider] });
      const insideParent = document.createElement('div');
      const elsewhere = document.createElement('div');

      insideParent.setAttribute('data-blok-toggle-children', '');
      parent.holder.appendChild(insideParent);
      elsewhere.setAttribute('data-blok-toggle-children', '');
      harness.workingArea.appendChild(elsewhere);
      elsewhere.appendChild(outsider.holder);
      harness.doc.setOrder(['p']);

      harness.emit({ blockId: 'p', type: 'remove', origin: 'undo' });

      expect(outsider.holder.parentElement).toBe(elsewhere);
    });
  });

  describe('empty-document repair', () => {
    it('writes the auto-inserted paragraph to the doc as well as memory', () => {
      const only = createBlock({ id: 'last' });
      const harness = createHarness({ blocks: [only] });
      const restored = createBlock({ id: 'after-last', name: 'paragraph', data: { text: '' } });

      (harness.handlers.insertDefaultBlock as unknown as ReturnType<typeof vi.fn>).mockReturnValue(restored);
      harness.doc.setOrder([]);

      harness.emit({ blockId: 'last', type: 'remove', origin: 'remote' });

      expect(harness.handlers.insertDefaultBlock).toHaveBeenCalledWith(true, 'after-last');
      expect(harness.doc.transactWithoutCapture).toHaveBeenCalled();
      expect(harness.doc.addBlock).toHaveBeenCalledWith({
        id: 'after-last',
        type: 'paragraph',
        data: { text: '' },
      });
    });

    it('does not repair while the doc still names blocks memory cannot hold', () => {
      const only = createBlock({ id: 'last' });
      const harness = createHarness({ blocks: [only] });

      // Memory empties, the doc does not: a memory-only paragraph here would
      // be invisible to the doc and collide with the peer's own repair.
      harness.doc.setOrder(['tool-this-client-lacks']);

      harness.emit({ blockId: 'last', type: 'remove', origin: 'remote' });

      expect(harness.handlers.insertDefaultBlock).not.toHaveBeenCalled();
      expect(harness.doc.addBlock).not.toHaveBeenCalled();
    });

    it('does not repair while memory still holds a block', () => {
      const gone = createBlock({ id: 'gone' });
      const kept = createBlock({ id: 'kept' });
      const harness = createHarness({ blocks: [gone, kept] });

      harness.doc.setOrder([]);

      harness.emit({ blockId: 'gone', type: 'remove', origin: 'remote' });

      expect(harness.handlers.insertDefaultBlock).not.toHaveBeenCalled();
      expect(harness.doc.addBlock).not.toHaveBeenCalled();
    });
  });

  describe('remote move', () => {
    it('reorders memory to the doc order', () => {
      const a = createBlock({ id: 'a' });
      const b = createBlock({ id: 'b' });
      const c = createBlock({ id: 'c' });
      const harness = createHarness({ blocks: [a, b, c] });

      const move = vi.spyOn(Blocks.prototype, 'move');

      harness.doc.setOrder(['c', 'a', 'b']);

      harness.emit({ blockId: 'c', type: 'move', origin: 'remote' });
      harness.runScheduled();

      expect(move).toHaveBeenCalled();
      expect(harness.repository.blocks.map((block) => block.id)).toEqual(['c', 'a', 'b']);
    });

    it('re-arms move batching after the first flush', () => {
      const a = createBlock({ id: 'a' });
      const b = createBlock({ id: 'b' });
      const harness = createHarness({ blocks: [a, b] });

      harness.doc.setOrder(['a', 'b']);
      harness.emit({ blockId: 'a', type: 'move', origin: 'remote' });
      harness.runScheduled();

      harness.doc.setOrder(['b', 'a']);
      harness.emit({ blockId: 'b', type: 'move', origin: 'remote' });
      harness.runScheduled();

      expect(harness.repository.blocks.map((block) => block.id)).toEqual(['b', 'a']);
    });

    it('moves nothing when the doc order already matches memory', () => {
      const a = createBlock({ id: 'a' });
      const b = createBlock({ id: 'b' });
      const harness = createHarness({ blocks: [a, b] });
      const move = vi.spyOn(Blocks.prototype, 'move');

      harness.doc.setOrder(['a', 'b']);

      harness.emit({ blockId: 'a', type: 'move', origin: 'remote' });
      harness.runScheduled();

      expect(move).not.toHaveBeenCalled();
    });

    it('does not reorder around ids only the doc holds', () => {
      const a = createBlock({ id: 'a' });
      const b = createBlock({ id: 'b' });
      const harness = createHarness({ blocks: [a, b] });

      harness.doc.setOrder(['doc-only', 'a', 'b']);

      harness.emit({ blockId: 'a', type: 'move', origin: 'remote' });
      harness.runScheduled();

      expect(harness.repository.blocks.map((block) => block.id)).toEqual(['a', 'b']);
    });

    it('drops a queued reconcile once the editor is torn down', () => {
      const a = createBlock({ id: 'a' });
      const b = createBlock({ id: 'b' });
      const harness = createHarness({ blocks: [a, b] });

      harness.doc.setOrder(['b', 'a']);
      harness.emit({ blockId: 'b', type: 'move', origin: 'remote' });
      harness.yjsSync.destroy();
      harness.runScheduled();

      expect(harness.repository.blocks.map((block) => block.id)).toEqual(['a', 'b']);
    });
  });

  describe('sanitizing what the doc hands back', () => {
    it('applies the tool sanitize config to remote data', async () => {
      const block = createBlock({ id: 'a', name: 'rich' });
      const harness = createHarness({
        blocks: [block],
        tools: { rich: { sanitizeConfig: { text: { b: true } } } },
      });

      harness.doc.put('a', { type: 'rich', data: { text: '<b>keep</b><i>strip</i>' } });

      harness.emit({ blockId: 'a', type: 'update', origin: 'remote' });
      await flush();

      expect(block.setData).toHaveBeenCalledWith({ text: '<b>keep</b>strip' });
    });

    it('does not throw while sanitizing data for a tool this client lacks', () => {
      vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const block = createBlock({ id: 'a', name: 'paragraph' });
      const harness = createHarness({ blocks: [block] });

      harness.doc.put('a', { type: 'exotic', data: { text: 'x' } });

      expect(() => harness.emit({ blockId: 'a', type: 'update', origin: 'remote' })).not.toThrow();
    });
  });

  describe('settling window', () => {
    const stopCapturingSpy = (harness: Harness): ReturnType<typeof vi.fn> =>
      harness.doc.manager.stopCapturing as unknown as ReturnType<typeof vi.fn>;

    /** Materialise `block` through the remote-add path, with the doc order taken from memory. */
    const materializeRemotely = (harness: Harness, block: Block): void => {
      composeSpy(harness.factory, () => block);
      harness.doc.put(block.id, { type: 'paragraph' });
      harness.doc.setOrder([...harness.repository.blocks.map((entry) => entry.id), block.id]);
      harness.emit({ blockId: block.id, type: 'add', origin: 'remote' });
    };

    const materializeReplay = (harness: Harness, block: Block): void => {
      composeSpy(harness.factory, () => block);
      harness.doc.put(block.id, { type: 'paragraph' });
      harness.doc.setOrder([...harness.repository.blocks.map((entry) => entry.id), block.id]);
      harness.emit({ blockId: block.id, type: 'add', origin: 'undo' });
    };

    it('marks a remotely added block as materializing, and no other block', () => {
      const other = createBlock({ id: 'other' });
      const created = createBlock({ id: 'arrived' });
      const harness = createHarness({ blocks: [other] });

      materializeRemotely(harness, created);

      expect(harness.yjsSync.isMaterializing(created)).toBe(true);
      // A root block's ancestor walk ends at "no parent": reading `.id` off the
      // absent parent, or answering "yes" for every block while a window is
      // open, both make every keystroke look like the editor's own write.
      expect(harness.yjsSync.isMaterializing(other)).toBe(false);
    });

    it('marks a remotely replayed block identical to a remote add', () => {
      const replay = createBlock({ id: 'replayed' });
      const harness = createHarness({ blocks: [createBlock({ id: 'anchor' })] });

      materializeReplay(harness, replay);

      expect(harness.yjsSync.isMaterializing(replay)).toBe(false);
    });

    it('opens a settling window for a remote batch and none for a replayed one', () => {
      const remote = createBlock({ id: 'remote-member' });
      const replayed = createBlock({ id: 'replay-member' });
      const harness = createHarness({ blocks: [createBlock({ id: 'anchor' })] });
      const byId = new Map<string, Block>([
        ['remote-member', remote],
        ['replay-member', replayed],
      ]);

      composeSpy(harness.factory, (options) => byId.get(options.id ?? '') ?? createBlock({ id: 'composed' }));

      harness.doc.put('remote-member', { type: 'paragraph' });
      harness.doc.put('replay-member', { type: 'paragraph' });
      harness.doc.setOrder(['anchor', 'remote-member', 'replay-member']);

      harness.emit({ blockIds: ['remote-member'], type: 'batch-add', origin: 'remote' });

      expect(harness.yjsSync.isMaterializing(remote)).toBe(true);

      harness.emit({ blockIds: ['replay-member'], type: 'batch-add', origin: 'redo' });

      expect(harness.yjsSync.isMaterializing(replayed)).toBe(false);
    });

    it('treats a block inside a materialised subtree as materialising', () => {
      const child = createBlock({ id: 'child', parentId: 'container' });
      const container = createBlock({ id: 'container', name: 'toggle', contentIds: ['child'] });
      const harness = createHarness({ blocks: [child] });

      materializeRemotely(harness, container);

      // The container is the block the doc materialised; the child's own write
      // is the editor's too, and only the ancestor walk can see that.
      expect(harness.yjsSync.isMaterializing(child)).toBe(true);
    });

    it('does not look the root up as if it were a block while walking parents', () => {
      const root = createBlock({ id: 'root-block' });
      const parent = createBlock({ id: 'container' });
      const child = createBlock({ id: 'child', parentId: 'container' });
      const harness = createHarness({ blocks: [root, parent, child] });

      materializeRemotely(harness, createBlock({ id: 'arrived' }));
      // The add's window is held through the next frame; close it so the
      // scoped window below is the only one open.
      harness.flushFrames();

      const lookup = vi.spyOn(harness.repository, 'getBlockById');

      harness.yjsSync.withAtomicOperation(() => {
        expect(harness.yjsSync.isReconciling(root)).toBe(false);
        expect(harness.yjsSync.isMaterializing(root)).toBe(false);
      }, { blockId: 'container' });

      expect(lookup).not.toHaveBeenCalledWith(null);
    });

    it('does not recurse forever when a settling walk meets a parent cycle', () => {
      const a = createBlock({ id: 'cyc-a', parentId: 'cyc-b' });
      const b = createBlock({ id: 'cyc-b', parentId: 'cyc-a' });
      const harness = createHarness({ blocks: [a, b] });

      materializeRemotely(harness, createBlock({ id: 'arrived' }));

      // A peer can write a parent cycle; without the visited set the ancestor
      // walk overflows the stack and takes the whole dispatch down.
      expect(harness.yjsSync.isMaterializing(a)).toBe(false);
    });

    it('does not seal capture when asked to settle a block with no open window', () => {
      const harness = createHarness({ blocks: [createBlock({ id: 'a' })] });

      harness.yjsSync.settleMaterialization('nobody');

      expect(stopCapturingSpy(harness)).not.toHaveBeenCalled();
    });

    it('seals capture only when the last settling window closes', () => {
      const first = createBlock({ id: 'member-one' });
      const second = createBlock({ id: 'member-two' });
      const harness = createHarness({ blocks: [createBlock({ id: 'anchor' })] });
      const byId = new Map<string, Block>([
        ['member-one', first],
        ['member-two', second],
      ]);

      composeSpy(harness.factory, (options) => byId.get(options.id ?? '') ?? createBlock({ id: 'composed' }));

      harness.doc.put('member-one', { type: 'paragraph' });
      harness.doc.put('member-two', { type: 'paragraph' });
      harness.doc.setOrder(['anchor', 'member-one', 'member-two']);
      harness.emit({ blockIds: ['member-one', 'member-two'], type: 'batch-add', origin: 'remote' });

      harness.yjsSync.settleMaterialization('member-one');

      // Sealing here would cut the still-settling block's write out of its own
      // undo entry — the one Ctrl+Z that must revert it would revert the user's
      // next word instead.
      expect(stopCapturingSpy(harness)).not.toHaveBeenCalled();
      expect(harness.yjsSync.isMaterializing(second)).toBe(true);

      harness.yjsSync.settleMaterialization('member-two');

      expect(stopCapturingSpy(harness)).toHaveBeenCalledTimes(1);
    });

    it('restarts the settling window when the same block is materialised again', () => {
      vi.useFakeTimers();

      try {
        const harness = createHarness({ blocks: [createBlock({ id: 'anchor' })] });

        materializeRemotely(harness, createBlock({ id: 'arrived' }));

        vi.advanceTimersByTime(300);

        harness.emit({ blockId: 'arrived', type: 'remove', origin: 'remote' });

        const second = createBlock({ id: 'arrived' });

        materializeRemotely(harness, second);

        // Past the FIRST window's deadline, short of the second's: the timer
        // the re-materialisation replaced must be gone, or it seals early and
        // the block's own write-back lands as a user edit.
        vi.advanceTimersByTime(150);

        expect(harness.yjsSync.isMaterializing(second)).toBe(true);
        expect(stopCapturingSpy(harness)).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('clears the timer of a settled window so it cannot seal a later reopen', () => {
      vi.useFakeTimers();

      try {
        const harness = createHarness({ blocks: [createBlock({ id: 'anchor' })] });

        materializeRemotely(harness, createBlock({ id: 'arrived' }));

        vi.advanceTimersByTime(100);

        harness.emit({ blockId: 'arrived', type: 'remove', origin: 'remote' });
        harness.yjsSync.settleMaterialization('arrived');

        const second = createBlock({ id: 'arrived' });

        materializeRemotely(harness, second);

        // The settled window's timer is still queued unless it was cancelled;
        // when it fires it closes the NEW window and seals capture early.
        vi.advanceTimersByTime(350);

        expect(stopCapturingSpy(harness)).toHaveBeenCalledTimes(1);
        expect(harness.yjsSync.isMaterializing(second)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('drops every settling window and its timer on destroy', () => {
      vi.useFakeTimers();

      try {
        const created = createBlock({ id: 'arrived' });
        const harness = createHarness({ blocks: [createBlock({ id: 'anchor' })] });

        materializeRemotely(harness, created);

        expect(harness.yjsSync.isMaterializing(created)).toBe(true);
        expect(vi.getTimerCount()).toBe(1);

        harness.yjsSync.destroy();

        // A torn-down editor must neither report itself as materialising nor
        // leave a timer that reaches back into the Yjs manager it no longer owns.
        expect(harness.yjsSync.isMaterializing(created)).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('walk guards', () => {
    it('does not walk the reconciliation tree while no window is open', () => {
      const parent = createBlock({ id: 'p' });
      const child = createBlock({ id: 'c', parentId: 'p' });
      const harness = createHarness({ blocks: [parent, child] });
      const lookup = vi.spyOn(harness.repository, 'getBlockById');

      // Neither walk can find anything with no window open, and the size check
      // is what keeps this path — asked on every block mutation — from reading
      // the repository at all.
      expect(harness.yjsSync.isReconciling(child)).toBe(false);
      expect(harness.yjsSync.isMaterializing(child)).toBe(false);

      expect(lookup).not.toHaveBeenCalled();
    });

    it('does not look the root up as if it were a block when removing a root block', () => {
      const root = createBlock({ id: 'solo' });
      const harness = createHarness({ blocks: [root] });

      harness.doc.setOrder(['solo']);

      const lookup = vi.spyOn(harness.repository, 'getBlockById');

      harness.emit({ blockId: 'solo', type: 'remove', origin: 'undo' });

      expect(lookup).not.toHaveBeenCalledWith(null);
    });
  });

  describe('removed-subtree lift', () => {
    it('lifts a nested child out of the removed subtree, not just the outermost stray', () => {
      const parent = createBlock({ id: 'p', name: 'toggle', contentIds: ['inner'] });
      const outer = createBlock({ id: 'outer' });
      const inner = createBlock({ id: 'inner', parentId: 'p' });
      const harness = createHarness({ blocks: [parent, outer, inner] });
      const container = document.createElement('div');
      const innerBody = document.createElement('div');

      container.setAttribute('data-blok-toggle-children', '');
      innerBody.setAttribute('data-blok-toggle-children', '');
      parent.holder.appendChild(container);
      container.appendChild(outer.holder);
      outer.holder.appendChild(innerBody);
      innerBody.appendChild(inner.holder);
      harness.doc.setOrder(['p']);

      harness.emit({ blockId: 'p', type: 'remove', origin: 'undo' });

      // The stray sweep moves OUTERMOST holders only, so `inner` rides inside
      // the stray that carried it — and the removed holder's teardown destroys
      // that whole subtree. Only the contentIds lift reaches it.
      expect(inner.holder.parentElement).toBe(harness.workingArea);
      expect(outer.holder.parentElement).toBe(harness.workingArea);
    });
  });

  describe('move replay', () => {
    it('re-asserts root holder order after a move whose doc record names no parent', () => {
      const first = createBlock({ id: 'a-first' });
      const second = createBlock({ id: 'b-second' });
      const harness = createHarness({ blocks: [first, second] });

      harness.workingArea.insertBefore(second.holder, first.holder);
      harness.doc.put('b-second', { type: 'paragraph' });
      harness.doc.setOrder(['a-first', 'b-second']);

      harness.emit({ blockId: 'b-second', type: 'move', origin: 'remote' });
      harness.runScheduled();

      // With no parentId key the move names the ROOT group; skipping it leaves
      // the holder where the stale-flat-array reparent left it, and the
      // invariant tripwire downstream trips on the next sync.
      expect([...harness.workingArea.children]).toEqual([first.holder, second.holder]);
    });

    it('does not re-reconcile a block an earlier move batch named', () => {
      const parent = createBlock({ id: 'p', name: 'toggle', contentIds: ['c-one', 'c-two'] });
      const first = createBlock({ id: 'c-one', parentId: 'p' });
      const second = createBlock({ id: 'c-two', parentId: 'p' });
      const solo = createBlock({ id: 'solo' });
      const harness = createHarness({ blocks: [parent, first, second, solo] });
      const container = document.createElement('div');

      container.setAttribute('data-blok-toggle-children', '');
      parent.holder.appendChild(container);
      container.appendChild(first.holder);
      container.appendChild(second.holder);

      harness.doc.put('p', { type: 'toggle', contentIds: ['c-two', 'c-one'] });
      harness.doc.put('c-one', { type: 'paragraph', parentId: 'p' });
      harness.doc.put('c-two', { type: 'paragraph', parentId: 'p' });
      harness.doc.put('solo', { type: 'paragraph' });
      harness.doc.setOrder(['p', 'c-one', 'c-two', 'solo']);

      harness.emit({ blockId: 'c-one', type: 'move', origin: 'remote' });
      harness.runScheduled();

      expect(parent.contentIds).toStrictEqual(['c-two', 'c-one']);

      parent.contentIds = ['c-one', 'c-two'];

      harness.emit({ blockId: 'solo', type: 'move', origin: 'remote' });
      harness.runScheduled();

      // A second batch that keeps the first batch's ids re-applies the doc's
      // order to a container nobody touched in this batch.
      expect(parent.contentIds).toStrictEqual(['c-one', 'c-two']);
    });
  });
});
