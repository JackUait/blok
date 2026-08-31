import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Header } from '../../../../../src/tools/header';
import { ColumnList } from '../../../../../src/tools/column-list';
import { Column } from '../../../../../src/tools/column';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import type { OutputBlockData, OutputData } from '../../../../../types';

/**
 * The doc — not just memory — must record a mid-container insert at the
 * position the user sees.
 *
 * The toolbox's replace-an-empty-child path detaches the old child to root,
 * inserts the new block PARENT-LESS at the old flat index, then re-attaches it
 * with `setBlockParent`. That last call is what writes the placement to the
 * doc, and it derives the preceding sibling from the parent's in-memory
 * `contentIds` — so an APPEND there hands the doc "last child" while the flat
 * array and the DOM both say "second child". Memory hides the divergence until
 * something rebuilds memory FROM the doc: undo/redo, a remote peer, a reload.
 * That is the e2e "the mid-column insert order survives undo -> redo"
 * regression, and it starts at the forward edit.
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

const docChildrenOf = (id: string): string[] | undefined => {
  const yblock = capturedYjs?.toJSON().find((block: OutputBlockData) => block.id === id);

  return yblock?.content;
};

const memoryChildrenOf = (saved: OutputData, parentId: string): string[] =>
  saved.blocks
    .filter((block) => block.parent === parentId)
    .map((block) => block.id)
    .filter((id): id is string => id !== undefined);

describe('mid-column insert — the DOC records the visible position', () => {
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

  /**
   * The toolbox's three calls for "slash menu on an empty child block":
   * detach the placeholder to root, insert the chosen tool at its flat index
   * (replacing it), then re-attach the new block to the original parent.
   */
  const insertOverSlot = (instance: TestEditor): string => {
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

    return inserted.id;
  };

  it('writes the inserted block as the SECOND child of the column, not the last', async () => {
    const instance = await createEditor();
    const insertedId = insertOverSlot(instance);

    await flush();

    expect(docChildrenOf('c1')).toEqual(['h1', insertedId, 'body1', 'author1']);
  });

  it('keeps that order through undo -> redo', async () => {
    const instance = await createEditor();
    const insertedId = insertOverSlot(instance);

    await flush();

    instance.history.undo();
    await flush();
    instance.history.redo();
    await flush();

    const saved = await instance.save();

    expect(docChildrenOf('c1')).toEqual(['h1', insertedId, 'body1', 'author1']);
    expect(memoryChildrenOf(saved, 'c1')).toEqual(['h1', insertedId, 'body1', 'author1']);
    // The untouched right column must not be reordered by the replay.
    expect(memoryChildrenOf(saved, 'c2')).toEqual(['h2', 'body2']);
  });
});
