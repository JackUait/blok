import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import type { BlockSelection } from '../../../../src/components/modules/blockSelection';
import type { Block } from '../../../../src/components/block';
import { Paragraph } from '../../../../src/tools/paragraph';
import { ColumnList } from '../../../../src/tools/column-list';
import { Column } from '../../../../src/tools/column';
import { TabsTool } from '../../../../src/tools/tabs';
import { TabTool } from '../../../../src/tools/tab';
import type { OutputBlockData, OutputData } from '../../../../types';

/**
 * A range selection never selects a layout block (column_list, column, tab):
 * it selects the blocks inside. A copy of a range that covers a whole layout
 * must still carry the layout, or the paste comes out flat.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  history: { undo: () => void };
  module: {
    yjsManager: { stopCapturing: () => void };
    blockManager: {
      blocks: Block[];
      deleteSelectedBlocksAndInsertReplacement: () => Block | undefined;
      getBlockById: (id: string) => Block | undefined;
      getSelectionSiblingRange: (anchor: Block, target: Block) => Block[];
    };
    blockSelection: BlockSelection;
  };
}

interface Entry {
  id: string;
  tool: string;
  data: Record<string, unknown>;
  parentId: string | null;
  contentIds?: string[];
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const P = (id: string, text: string, parent?: string): OutputBlockData =>
  ({ id, type: 'paragraph', data: { text }, ...(parent === undefined ? {} : { parent }) });

const columnsDoc = (): OutputBlockData[] => [
  P('pre', 'Before'),
  { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
  { id: 'c1', type: 'column', data: { widthRatio: 2 }, parent: 'cl', content: ['c1p'] },
  P('c1p', 'Left col', 'c1'),
  { id: 'c2', type: 'column', data: { widthRatio: 1 }, parent: 'cl', content: ['c2p'] },
  P('c2p', 'Right col', 'c2'),
  P('post', 'After'),
];

class LockedParagraph extends Paragraph {
  public isReadOnly(): boolean {
    return true;
  }
}

/** A layout whose children are user content, like a database row and its page body. */
class PageShell extends Paragraph {
  public static get isLayout(): boolean {
    return true;
  }
}

const pageDoc = (): OutputBlockData[] => [
  P('pre', 'Before'),
  { id: 'page', type: 'page_shell', data: { text: 'Title' }, content: ['b1', 'b2'] },
  P('b1', 'Body one', 'page'),
  P('b2', 'Body two', 'page'),
];

const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, locked: LockedParagraph, page_shell: PageShell, column_list: ColumnList, column: Column, tabs: TabsTool, tab: TabTool },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;

  return instance;
};

const block = (instance: TestEditor, id: string): Block => {
  const found = instance.module.blockManager.getBlockById(id);

  if (found === undefined) {
    throw new Error(`no block ${id}`);
  }

  return found;
};

const copySelected = async (instance: TestEditor, selection: Block[]): Promise<Map<string, string>> => {
  for (const selected of selection) {
    selected.selected = true;
  }

  const written = new Map<string, string>();

  await instance.module.blockSelection.copySelectedBlocks({
    preventDefault: () => undefined,
    clipboardData: { setData: (type: string, value: string): void => {
      written.set(type, value);
    } },
  } as unknown as ClipboardEvent);

  return written;
};

/** Select what a Shift+click from `from` to `to` selects, then copy it. */
const copyRange = (instance: TestEditor, from: string, to: string): Promise<Map<string, string>> =>
  copySelected(instance, instance.module.blockManager.getSelectionSiblingRange(block(instance, from), block(instance, to)));

const payload = (written: Map<string, string>): Entry[] => JSON.parse(written.get('application/x-blok') ?? '[]') as Entry[];

const occurrences = (text: string, needle: string): number => text.split(needle).length - 1;

beforeEach(() => {
  holder = document.createElement('div');
  document.body.appendChild(holder);
});

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  holder?.remove();
});

describe('copy of a range across a column layout', () => {
  it('carries the column_list and its columns when the range covers them', async () => {
    const written = await copyRange(await boot(columnsDoc()), 'pre', 'post');

    expect(payload(written).map((entry) => [entry.id, entry.tool, entry.parentId])).toEqual([
      ['pre', 'paragraph', null],
      ['cl', 'column_list', null],
      ['c1', 'column', 'cl'],
      ['c1p', 'paragraph', 'c1'],
      ['c2', 'column', 'cl'],
      ['c2p', 'paragraph', 'c2'],
      ['post', 'paragraph', null],
    ]);
    // An even column (widthRatio 1) saves no widthRatio.
    expect(payload(written).filter((entry) => entry.tool === 'column').map((entry) => entry.data)).toEqual([{ widthRatio: 2 }, {}]);
  });

  it('writes each column text once in text/html and text/plain', async () => {
    const written = await copyRange(await boot(columnsDoc()), 'pre', 'post');

    for (const flavor of ['text/html', 'text/plain']) {
      const text = written.get(flavor) ?? '';

      expect([flavor, occurrences(text, 'Left col'), occurrences(text, 'Right col')]).toEqual([flavor, 1, 1]);
    }
  });

  it('carries the column_list when a range inside it fills every column', async () => {
    const written = await copyRange(await boot(columnsDoc()), 'c1p', 'c2p');

    expect(payload(written).map((entry) => entry.id)).toEqual(['cl', 'c1', 'c1p', 'c2', 'c2p']);
  });

  it('carries only the blocks when the selection leaves part of the layout out', async () => {
    const instance = await boot(columnsDoc());
    const written = await copySelected(instance, [block(instance, 'pre'), block(instance, 'c1p')]);

    expect(payload(written).map((entry) => entry.id)).toEqual(['pre', 'c1p']);
  });

  it('never carries a lone tab when the range fills one tab', async () => {
    const written = await copyRange(await boot([
      { id: 'tabs', type: 'tabs', data: {}, content: ['t1', 't2'] },
      { id: 't1', type: 'tab', data: { title: 'Alpha' }, parent: 'tabs', content: ['a1', 'a2'] },
      P('a1', 'one', 't1'),
      P('a2', 'two', 't1'),
      { id: 't2', type: 'tab', data: { title: 'Beta' }, parent: 'tabs', content: ['b1'] },
      P('b1', 'three', 't2'),
    ]), 'a1', 'a2');

    expect(payload(written).map((entry) => entry.id)).toEqual(['a1', 'a2']);
  });

  it('carries a column_list inside a tab, but not the tab', async () => {
    const written = await copyRange(await boot([
      { id: 'tabs', type: 'tabs', data: {}, content: ['t1'] },
      { id: 't1', type: 'tab', data: { title: 'Alpha' }, parent: 'tabs', content: ['top', 'cl', 'end'] },
      P('top', 'top', 't1'),
      { id: 'cl', type: 'column_list', data: {}, parent: 't1', content: ['c1', 'c2'] },
      { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['c1p'] },
      P('c1p', 'left', 'c1'),
      { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['c2p'] },
      P('c2p', 'right', 'c2'),
      P('end', 'end', 't1'),
    ]), 'top', 'end');

    expect(payload(written).map((entry) => entry.id)).toEqual(['top', 'cl', 'c1', 'c1p', 'c2', 'c2p', 'end']);
  });
});

describe('delete of a range across a column layout', () => {
  it('leaves no empty column_list behind', async () => {
    const instance = await boot(columnsDoc());
    const { blockManager } = instance.module;

    for (const selected of blockManager.getSelectionSiblingRange(block(instance, 'pre'), block(instance, 'post'))) {
      selected.selected = true;
    }
    blockManager.deleteSelectedBlocksAndInsertReplacement();

    await vi.waitFor(() => {
      expect(blockManager.blocks.map((live) => live.name)).toEqual(['paragraph']);
    });
  });

  it('keeps a read-only block and its layout, and deletes the rest', async () => {
    const instance = await boot(columnsDoc().map((saved) => saved.id === 'c2p' ? { ...saved, type: 'locked' } : saved));
    const { blockManager } = instance.module;

    for (const selected of blockManager.getSelectionSiblingRange(block(instance, 'pre'), block(instance, 'post'))) {
      selected.selected = true;
    }
    blockManager.deleteSelectedBlocksAndInsertReplacement();

    await vi.waitFor(() => {
      expect(blockManager.blocks.map((live) => live.id)).toEqual(['cl', 'c2', 'c2p']);
    });
  });

  it('comes back whole on undo', async () => {
    const instance = await boot(columnsDoc());
    const { blockManager } = instance.module;

    instance.module.yjsManager.stopCapturing();
    for (const selected of blockManager.getSelectionSiblingRange(block(instance, 'pre'), block(instance, 'post'))) {
      selected.selected = true;
    }
    blockManager.deleteSelectedBlocksAndInsertReplacement();
    await vi.waitFor(() => {
      expect(blockManager.blocks).toHaveLength(1);
    });
    instance.module.yjsManager.stopCapturing();
    instance.history.undo();

    await vi.waitFor(async () => {
      expect((await instance.save()).blocks.map((saved) => [saved.id, saved.parent ?? null, saved.data.widthRatio])).toEqual([
        ['pre', null, undefined],
        ['cl', null, undefined],
        ['c1', 'cl', 2],
        ['c1p', 'c1', undefined],
        ['c2', 'cl', undefined],
        ['c2p', 'c2', undefined],
        ['post', null, undefined],
      ]);
    });
  });
});

describe('a layout whose children are user content', () => {
  it('is not copied when its whole body is selected', async () => {
    const instance = await boot(pageDoc());
    const written = await copySelected(instance, [block(instance, 'b1'), block(instance, 'b2')]);

    expect(payload(written).map((entry) => entry.id)).toEqual(['b1', 'b2']);
  });

  it('is not deleted when its whole body is deleted', async () => {
    const instance = await boot(pageDoc());
    const { blockManager } = instance.module;

    block(instance, 'b1').selected = true;
    block(instance, 'b2').selected = true;
    blockManager.deleteSelectedBlocksAndInsertReplacement();

    await vi.waitFor(() => {
      expect(blockManager.blocks.map((live) => live.id).slice(0, 2)).toEqual(['pre', 'page']);
      expect(blockManager.getBlockById('b1')).toBeUndefined();
    });
  });
});
