import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { ColumnList } from '../../../../../src/tools/column-list';
import { Column } from '../../../../../src/tools/column';
import { ToggleItem } from '../../../../../src/tools/toggle';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import type { OutputBlockData, OutputData } from '../../../../../types';

/**
 * `api.blocks.insertMany` must ADD its batch to the document, never replace it.
 *
 * The in-memory store only ever appended, so `save()` and the author's screen
 * looked right while the Y.Doc had been emptied of everything that came before
 * — the blocks were gone for every peer and for the author's next reload. Every
 * assertion here therefore reads the DOC, not the store.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  blocks: {
    insertMany: (blocks: OutputBlockData[], index?: number) => Array<{ id: string }>;
    insert: (type?: string, data?: unknown, config?: unknown, index?: number) => { id: string };
    getBlocksCount: () => number;
  };
  history: { undo: () => void; redo: () => void; canUndo: () => boolean };
  save: () => Promise<OutputData>;
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;
let capturedYjs: YjsManager | undefined;

const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};

const flushThroughFrame = async (): Promise<void> => {
  await flush();
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  await flush();
};

/**
 * Y.UndoManager merges writes made within CAPTURE_TIMEOUT_MS (500ms) into one
 * entry, so an earlier edit only counts as a SEPARATE entry past that window.
 */
const sleepPastCaptureWindow = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 700));

const docIds = (): string[] =>
  (capturedYjs?.toJSON() ?? [])
    .map((block: OutputBlockData) => block.id)
    .filter((id): id is string => id !== undefined);

const docChildrenOf = (id: string): string[] | undefined =>
  (capturedYjs?.toJSON() ?? []).find((block: OutputBlockData) => block.id === id)?.content;

const docParentOf = (id: string): string | undefined =>
  (capturedYjs?.toJSON() ?? []).find((block: OutputBlockData) => block.id === id)?.parent;

describe('api.blocks.insertMany — the DOC keeps the blocks that were already there', () => {
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
  });

  afterEach(async () => {
    editor?.destroy();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await flush();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    capturedYjs = undefined;
    vi.restoreAllMocks();
  });

  const createEditor = async (data: OutputData): Promise<TestEditor> => {
    const instance = new Blok({
      holder,
      tools: {
        paragraph: Paragraph,
        column_list: ColumnList,
        column: Column,
        toggle: ToggleItem,
      },
      data,
    }) as unknown as TestEditor;

    editor = instance;
    await instance.isReady;
    await flush();

    return instance;
  };

  const singleBlockDocument = (): OutputData => ({
    blocks: [{ id: 'keep', type: 'paragraph', data: { text: 'keep me' } }],
  });

  it('leaves an already-synced block in the document', async () => {
    const instance = await createEditor(singleBlockDocument());

    instance.blocks.insertMany([
      { id: 'first', type: 'paragraph', data: { text: 'first' } },
      { id: 'second', type: 'paragraph', data: { text: 'second' } },
    ]);

    await flush();

    expect(docIds()).toContain('keep');
  });

  it('writes the inserted batch into the document at the requested index', async () => {
    const instance = await createEditor({
      blocks: [
        { id: 'a', type: 'paragraph', data: { text: 'a' } },
        { id: 'b', type: 'paragraph', data: { text: 'b' } },
      ],
    });

    instance.blocks.insertMany([
      { id: 'x', type: 'paragraph', data: { text: 'x' } },
      { id: 'y', type: 'paragraph', data: { text: 'y' } },
    ], 1);

    await flush();

    expect(docIds()).toEqual(['a', 'x', 'y', 'b']);
  });

  it('keeps the hierarchy of a nested batch', async () => {
    const instance = await createEditor(singleBlockDocument());

    instance.blocks.insertMany([
      { id: 'cl', type: 'column_list', data: {}, content: ['col'] },
      { id: 'col', type: 'column', data: {}, parent: 'cl', content: ['inner'] },
      { id: 'inner', type: 'paragraph', data: { text: 'inner' }, parent: 'col' },
    ]);

    await flush();

    expect(docChildrenOf('cl')).toEqual(['col']);
    expect(docChildrenOf('col')).toEqual(['inner']);
    expect(docParentOf('col')).toBe('cl');
    expect(docParentOf('inner')).toBe('col');
    expect(docIds()).toEqual(['keep', 'cl', 'col', 'inner']);
  });

  it('keeps the undo history recorded before the batch', async () => {
    const instance = await createEditor(singleBlockDocument());

    instance.blocks.insert('paragraph', { text: 'typed earlier' }, undefined, 1);
    await flush();
    await sleepPastCaptureWindow();

    instance.blocks.insertMany([
      { id: 'bulk', type: 'paragraph', data: { text: 'bulk' } },
    ]);
    await flush();

    expect(instance.history.canUndo()).toBe(true);

    instance.history.undo();
    await flushThroughFrame();

    expect(docIds()).not.toContain('bulk');
    expect(docIds()).toContain('keep');
    expect(instance.history.canUndo()).toBe(true);
  });

  describe('a batch block whose parent is already in the document', () => {
    const toggleDocument = (): OutputData => ({
      blocks: [
        { id: 'p0', type: 'paragraph', data: { text: 'p0' } },
        { id: 'tog', type: 'toggle', data: { text: 'tog', isOpen: true }, content: ['c1'] },
        { id: 'c1', type: 'paragraph', data: { text: 'c1' }, parent: 'tog' },
        { id: 'p9', type: 'paragraph', data: { text: 'p9' } },
      ],
    });

    /** `id^parent[content]` per block, in order. */
    const shape = (blocks: OutputBlockData[]): string[] =>
      blocks.map((block) => `${String(block.id)}^${block.parent ?? '-'}[${(block.content ?? []).join(',')}]`);

    it('keeps the parent in the saved document and in the doc', async () => {
      const instance = await createEditor(toggleDocument());

      instance.blocks.insertMany([
        { id: 'x', type: 'paragraph', data: { text: 'x' }, parent: 'tog' },
        { id: 'y', type: 'paragraph', data: { text: 'y' }, parent: 'tog' },
      ], 3);
      await flush();

      const expected = ['p0^-[]', 'tog^-[c1,x,y]', 'c1^tog[]', 'x^tog[]', 'y^tog[]', 'p9^-[]'];

      expect(shape((await instance.save()).blocks)).toEqual(expected);
      expect(shape(capturedYjs?.toJSON() ?? [])).toEqual(expected);
    });

    it('puts the block before the children that follow the index', async () => {
      const instance = await createEditor(toggleDocument());

      instance.blocks.insertMany([{ id: 'x', type: 'paragraph', data: { text: 'x' }, parent: 'tog' }], 2);
      await flush();

      const expected = ['p0^-[]', 'tog^-[x,c1]', 'x^tog[]', 'c1^tog[]', 'p9^-[]'];

      expect(shape((await instance.save()).blocks)).toEqual(expected);
      expect(shape(capturedYjs?.toJSON() ?? [])).toEqual(expected);
    });

    it('undoes and redoes the batch as one step', async () => {
      const instance = await createEditor(toggleDocument());

      await sleepPastCaptureWindow();
      instance.blocks.insertMany([{ id: 'x', type: 'paragraph', data: { text: 'x' }, parent: 'tog' }], 3);
      await flush();

      instance.history.undo();
      await flushThroughFrame();

      expect(shape(capturedYjs?.toJSON() ?? [])).toEqual(['p0^-[]', 'tog^-[c1]', 'c1^tog[]', 'p9^-[]']);
      expect(shape((await instance.save()).blocks)).toEqual(['p0^-[]', 'tog^-[c1]', 'c1^tog[]', 'p9^-[]']);

      instance.history.redo();
      await flushThroughFrame();

      const expected = ['p0^-[]', 'tog^-[c1,x]', 'c1^tog[]', 'x^tog[]', 'p9^-[]'];

      expect(shape(capturedYjs?.toJSON() ?? [])).toEqual(expected);
      expect(shape((await instance.save()).blocks)).toEqual(expected);
    });
  });
});
