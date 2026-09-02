import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Header } from '../../../../../src/tools/header';
import { ColumnList } from '../../../../../src/tools/column-list';
import { Column } from '../../../../../src/tools/column';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import type { OutputBlockData, OutputData } from '../../../../../types';

/**
 * Undoing a reparent that sends a block back to ROOT must mirror the doc into
 * memory, exactly like the non-root direction already does.
 *
 * The doc stores "root" as the ABSENCE of the parentId key, so an undo of a
 * root -> container reparent DELETES the key rather than writing a new value.
 * `handleYjsUpdate` only saw that deletion for remote origins, on the premise
 * that local replays restore the parent through UndoHistory's placement
 * callback — but that callback only fires for DRAG moves (writes made inside a
 * move group). A reparent written by the plain captured path — the blocks API,
 * keyboard Tab/Shift+Tab nesting, the toolbox's insert-into-a-container — has
 * no placement record, so its undo left the block parented in memory while the
 * doc said root: the flat array followed the doc, contentIds and the DOM did
 * not, and save() then emitted a document that did not match the screen.
 *
 * `stopCapturing()` between the insert and the re-attach is what >500ms of CPU
 * starvation does to that sequence under a loaded CI shard: the capture window
 * closes mid-gesture and one undo rewinds only the re-attach.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
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
    setBlockParent: (id: string, parentId: string | null) => void;
  };
  history: { undo: () => void; redo: () => void };
}

const buildArticleColumns = (): OutputData => ({
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['h1', 'slot', 'body1', 'author1'] },
    { id: 'h1', type: 'header', data: { text: 'Left title', level: 2 }, parent: 'c1' },
    { id: 'slot', type: 'paragraph', data: { text: '' }, parent: 'c1' },
    { id: 'body1', type: 'paragraph', data: { text: 'Left body text' }, parent: 'c1' },
    { id: 'author1', type: 'paragraph', data: { text: 'Author: someone' }, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['h2', 'body2'] },
    { id: 'h2', type: 'header', data: { text: 'Right title', level: 2 }, parent: 'c2' },
    { id: 'body2', type: 'paragraph', data: { text: 'Right body text' }, parent: 'c2' },
  ],
});

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;
let capturedYjs: YjsManager | undefined;

const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};

const docParentOf = (id: string): string | null | undefined => {
  const yblock = capturedYjs?.toJSON().find((block: OutputBlockData) => block.id === id);

  return yblock === undefined ? undefined : yblock.parent ?? null;
};

const docChildrenOf = (id: string): string[] | undefined =>
  capturedYjs?.toJSON().find((block: OutputBlockData) => block.id === id)?.content;

describe('yjs-sync — undo of a reparent back to root', () => {
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
    await flush();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    capturedYjs = undefined;
    vi.restoreAllMocks();
  });

  const createEditor = async (): Promise<TestEditor> => {
    const instance = new Blok({
      holder,
      tools: {
        paragraph: Paragraph,
        header: Header,
        column_list: ColumnList,
        column: Column,
      },
      data: buildArticleColumns(),
    }) as unknown as TestEditor;

    editor = instance;
    await instance.isReady;
    await flush();

    return instance;
  };

  it('sends the block back to root in memory, not just in the doc', async () => {
    const instance = await createEditor();
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

    // Close the undo capture window BEFORE the re-attach, so a single undo
    // rewinds the reparent alone.
    capturedYjs?.stopCapturing();
    instance.blocks.setBlockParent(inserted.id, 'c1');
    await flush();

    instance.history.undo();
    await flush();

    expect(docParentOf(inserted.id)).toBeNull();
    expect(docChildrenOf('c1')).toEqual(['h1', 'body1', 'author1']);

    // save() re-derives the tree from memory and refuses to emit a document
    // whose child order disagrees with the DOM, so it is the honest witness
    // that memory followed the doc.
    const saved = await instance.save();
    const insertedInMemory = saved.blocks.find((block) => block.id === inserted.id);

    expect(insertedInMemory?.parent ?? null).toBeNull();
    expect(
      saved.blocks.filter((block) => block.parent === 'c1').map((block) => block.id)
    ).toEqual(['h1', 'body1', 'author1']);
  });

  it('redoes the reparent back into the column', async () => {
    const instance = await createEditor();
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

    capturedYjs?.stopCapturing();
    instance.blocks.setBlockParent(inserted.id, 'c1');
    await flush();

    instance.history.undo();
    await flush();
    instance.history.redo();
    await flush();

    expect(docChildrenOf('c1')).toEqual(['h1', inserted.id, 'body1', 'author1']);

    const saved = await instance.save();

    expect(
      saved.blocks.filter((block) => block.parent === 'c1').map((block) => block.id)
    ).toEqual(['h1', inserted.id, 'body1', 'author1']);
  });
});
