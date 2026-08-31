import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Header } from '../../../../../src/tools/header';
import { ColumnList } from '../../../../../src/tools/column-list';
import { Column } from '../../../../../src/tools/column';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { BlockManager } from '../../../../../src/components/modules/blockManager';
import type { OutputBlockData, OutputData, PasteEvent } from '../../../../../types';

/**
 * A replace-insert must REMOVE the replaced block from the doc, not just from
 * memory.
 *
 * The toolbox's "empty paragraph + pick a tool" flow calls
 * `blocks.insert(..., replace = true)`. Memory and the DOM drop the replaced
 * slot (Blocks.insert splices + destroys it), but the only doc write on that
 * path is `addBlock` of the NEW block — no `removeBlock` for the slot. `save()`
 * reads memory, so it looks right; the Y.Doc keeps a ghost empty paragraph that
 * resurrects for any peer syncing the doc or any reload built from it.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  blocks: {
    insert: (
      type?: string,
      data?: unknown,
      config?: unknown,
      index?: number,
      needToFocus?: boolean,
      replace?: boolean
    ) => { id: string };
    getBlockIndex: (id: string) => number | undefined;
    getBlockByIndex: (index: number) => { id: string } | undefined;
    getBlocksCount: () => number;
    setBlockParent: (id: string, parentId: string | null) => void;
    transact: (fn: () => void) => void;
  };
  history: { undo: () => void; redo: () => void };
}

const buildRootDocument = (): OutputData => ({
  blocks: [
    { id: 'intro', type: 'paragraph', data: { text: 'Intro' } },
    { id: 'slot', type: 'paragraph', data: { text: '' } },
    { id: 'outro', type: 'paragraph', data: { text: 'Outro' } },
  ],
});

const buildColumnsDocument = (): OutputData => ({
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['h1', 'slot', 'body1'] },
    { id: 'h1', type: 'header', data: { text: 'Left title', level: 2 }, parent: 'c1' },
    { id: 'slot', type: 'paragraph', data: { text: '' }, parent: 'c1' },
    { id: 'body1', type: 'paragraph', data: { text: 'Left body text' }, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['body2'] },
    { id: 'body2', type: 'paragraph', data: { text: 'Right body text' }, parent: 'c2' },
  ],
});

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;
let capturedYjs: YjsManager | undefined;
let capturedBlockManager: BlockManager | undefined;

const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};

/**
 * Undo/redo rebuilds memory from the doc across an animation frame, so the
 * microtask flush alone reads a half-applied tree.
 */
const flushThroughFrame = async (): Promise<void> => {
  await flush();
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  await flush();
};

/**
 * Y.UndoManager merges writes made within CAPTURE_TIMEOUT_MS (500ms) into one
 * undo entry. A real toolbox gesture (hover, click +, wait for the popover,
 * click a tool) takes longer than that, so the tests that model it must too —
 * the split into two entries is exactly what the merge rule has to handle.
 */
const sleepPastCaptureWindow = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 700));

const docIds = (): string[] =>
  (capturedYjs?.toJSON() ?? []).map((block: OutputBlockData) => block.id).filter((id): id is string => id !== undefined);

const docChildrenOf = (id: string): string[] | undefined =>
  (capturedYjs?.toJSON() ?? []).find((block: OutputBlockData) => block.id === id)?.content;

/**
 * Live block ids, read from the repository rather than `save()`: an empty
 * paragraph fails its tool's `validate`, so the Saver drops the very block this
 * test is about.
 */
const memoryIds = (instance: TestEditor): string[] =>
  Array.from({ length: instance.blocks.getBlocksCount() }, (_, index) =>
    instance.blocks.getBlockByIndex(index)?.id).filter((id): id is string => id !== undefined);

describe('replace-insert — the DOC drops the replaced slot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);

    const originalFromJSON = YjsManager.prototype.fromJSON;

    vi.spyOn(YjsManager.prototype, 'fromJSON').mockImplementation(function (
      this: YjsManager,
      blocks: Parameters<YjsManager['fromJSON']>[0]
    ) {
      capturedYjs = this;

      return originalFromJSON.call(this, blocks);
    });

    const originalPrepare = BlockManager.prototype.prepare;

    vi.spyOn(BlockManager.prototype, 'prepare').mockImplementation(function (this: BlockManager) {
      capturedBlockManager = this;

      return originalPrepare.call(this);
    });
  });

  afterEach(async () => {
    editor?.destroy();
    // Let the sync's scheduled holder-order reconcile run while the holders
    // are still mounted: it settles across a RAF, and detaching the holder
    // first leaves it reading a half-dismantled DOM and throwing its dev
    // tripwire out of band.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await flush();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    capturedYjs = undefined;
    capturedBlockManager = undefined;
    vi.restoreAllMocks();
  });

  const createEditor = async (data: OutputData): Promise<TestEditor> => {
    const instance = new Blok({
      holder,
      tools: {
        paragraph: Paragraph,
        header: Header,
        column_list: ColumnList,
        column: Column,
      },
      data,
    }) as unknown as TestEditor;

    editor = instance;
    await instance.isReady;
    await flush();

    return instance;
  };

  /**
   * The toolbox's root-level shape: no parent, so no transaction wrap and no
   * parent dance — a bare replace of the empty paragraph.
   */
  const replaceRootSlot = (instance: TestEditor): string =>
    instance.blocks.insert(
      'header',
      { text: 'Inserted', level: 3 },
      undefined,
      instance.blocks.getBlockIndex('slot'),
      undefined,
      true
    ).id;

  /**
   * The toolbox's parented shape (`Toolbox.insertNewBlock`): detach the slot to
   * root, replace it, re-attach the new block — all inside one tool transaction.
   */
  const replaceColumnSlot = (instance: TestEditor): string => {
    let insertedId = '';

    instance.blocks.transact(() => {
      const slotIndex = instance.blocks.getBlockIndex('slot');

      instance.blocks.setBlockParent('slot', null);

      const inserted = instance.blocks.insert(
        'header',
        { text: 'Inserted', level: 3 },
        undefined,
        slotIndex,
        undefined,
        true
      );

      instance.blocks.setBlockParent(inserted.id, 'c1');
      insertedId = inserted.id;
    });

    return insertedId;
  };

  it('leaves no ghost when the slot lives inside a column', async () => {
    const instance = await createEditor(buildColumnsDocument());
    const insertedId = replaceColumnSlot(instance);

    await flush();

    expect(docIds()).not.toContain('slot');
    expect([...docIds()].sort()).toEqual([...memoryIds(instance)].sort());
    expect(docIds()).toContain(insertedId);

    // One undo press puts the slot back where it was — the detach-to-root,
    // the replace and the re-attach are one tool transaction.
    instance.history.undo();
    await flushThroughFrame();

    expect(docChildrenOf('c1')).toEqual(['h1', 'slot', 'body1']);
    expect(docIds()).not.toContain(insertedId);
    expect([...docIds()].sort()).toEqual([...memoryIds(instance)].sort());
  });

  it('leaves no ghost when the slot is a root block', async () => {
    const instance = await createEditor(buildRootDocument());
    const insertedId = replaceRootSlot(instance);

    await flush();

    expect(docIds()).not.toContain('slot');
    expect([...docIds()].sort()).toEqual([...memoryIds(instance)].sort());
    expect(docIds()).toContain(insertedId);
  });

  it('leaves no ghost when a paste replaces the slot', async () => {
    const instance = await createEditor(buildRootDocument());
    const blockManager = capturedBlockManager;

    if (blockManager === undefined) {
      throw new Error('BlockManager was not captured');
    }

    const slotIndex = instance.blocks.getBlockIndex('slot');

    if (slotIndex === undefined) {
      throw new Error('slot block not found');
    }

    blockManager.currentBlockIndex = slotIndex;

    const pastedElement = document.createElement('h2');

    pastedElement.textContent = 'Pasted heading';

    const pasteEvent = new CustomEvent('tag', { detail: { data: pastedElement } }) as PasteEvent;
    const pastedBlock = await blockManager.paste('header', pasteEvent, true);

    await flush();

    expect(docIds()).not.toContain('slot');
    expect(docIds()).toContain(pastedBlock.id);
    expect([...docIds()].sort()).toEqual([...memoryIds(instance)].sort());
  });

  /**
   * The plus button builds an empty scaffold paragraph and opens the toolbox on
   * it; picking a tool replaces that scaffold. The scaffold is never a state the
   * user committed to (Escape deletes it again), so the whole gesture is ONE
   * undo press — even when the user takes longer than the capture window to pick.
   */
  it('drops a slot the same gesture created, in one undo press', async () => {
    const instance = await createEditor({
      blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Existing paragraph' } }],
    });
    const blockManager = capturedBlockManager;

    if (blockManager === undefined) {
      throw new Error('BlockManager was not captured');
    }

    const scaffold = blockManager.insertDefaultBlockAtIndex(1, true, false, true);

    await flush();
    await sleepPastCaptureWindow();

    const insertedId = instance.blocks.insert(
      'header',
      { text: 'Inserted', level: 3 },
      undefined,
      1,
      undefined,
      true
    ).id;

    await flush();

    expect(docIds()).not.toContain(scaffold.id);

    instance.history.undo();
    await flushThroughFrame();

    expect(docIds()).toEqual(['p1']);
    expect(memoryIds(instance)).toEqual(['p1']);

    instance.history.redo();
    await flushThroughFrame();

    expect(docIds()).toEqual(['p1', insertedId]);
    expect(memoryIds(instance)).toEqual(['p1', insertedId]);
  });

  it('drops a slot the same gesture created when a paste replaces it', async () => {
    const instance = await createEditor({
      blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Existing paragraph' } }],
    });
    const blockManager = capturedBlockManager;

    if (blockManager === undefined) {
      throw new Error('BlockManager was not captured');
    }

    const scaffold = blockManager.insertDefaultBlockAtIndex(1, true, false, true);

    await flush();
    await sleepPastCaptureWindow();

    blockManager.currentBlockIndex = 1;

    const pastedElement = document.createElement('h2');

    pastedElement.textContent = 'Pasted heading';

    const pasteEvent = new CustomEvent('tag', { detail: { data: pastedElement } }) as PasteEvent;
    const pastedBlock = await blockManager.paste('header', pasteEvent, true);

    await flush();

    expect(docIds()).not.toContain(scaffold.id);

    instance.history.undo();
    await flushThroughFrame();

    expect(docIds()).toEqual(['p1']);
    expect(memoryIds(instance)).toEqual(['p1']);

    instance.history.redo();
    await flushThroughFrame();

    expect(docIds()).toEqual(['p1', pastedBlock.id]);
  });

  it('restores the slot on undo and drops it again on redo', async () => {
    const instance = await createEditor(buildRootDocument());
    const insertedId = replaceRootSlot(instance);

    await flush();

    instance.history.undo();
    await flushThroughFrame();

    expect(docIds()).toContain('slot');
    expect(docIds()).not.toContain(insertedId);
    expect([...docIds()].sort()).toEqual([...memoryIds(instance)].sort());

    instance.history.redo();
    await flushThroughFrame();

    expect(docIds()).toContain(insertedId);
    expect(docIds()).not.toContain('slot');
    expect([...docIds()].sort()).toEqual([...memoryIds(instance)].sort());
  });
});
