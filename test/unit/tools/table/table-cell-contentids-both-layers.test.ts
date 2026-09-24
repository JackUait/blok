/**
 * A table's cell blocks are listed in the table's `contentIds` in memory, in
 * the saved JSON and in the Yjs doc, and every cell names the table as its
 * parent in all three. The grid (`data.content[r][c].blocks`) still decides
 * where a cell sits; `contentIds` holds the same ids in row-major order.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../src/blok';
import { Table } from '../../../../src/tools/table/index';
import { Paragraph } from '../../../../src/tools/paragraph';
import { YjsManager } from '../../../../src/components/modules/yjs';
import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import type { API, OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
}

interface GridCell {
  blocks: string[];
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;
let capturedYjs: YjsManager | undefined;

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, table: Table },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await settle();

  return instance;
};

const isGrid = (value: unknown): value is GridCell[][] =>
  Array.isArray(value) && value.every(row => Array.isArray(row));

const gridIds = (table: OutputBlockData): string[] => {
  const grid: unknown = table.data.content;

  if (!isGrid(grid)) {
    throw new Error('table has no grid');
  }

  return grid.flat().flatMap(cell => cell.blocks);
};

const findTable = (blocks: OutputBlockData[]): OutputBlockData => {
  const table = blocks.find(block => block.type === 'table');

  if (table === undefined) {
    throw new Error('no table');
  }

  return table;
};

const docBlocks = (): OutputBlockData[] => {
  if (capturedYjs === undefined) {
    throw new Error('YjsManager was never loaded');
  }

  return capturedYjs.toJSON();
};

const expectCellsListedInEveryLayer = async (instance: TestEditor, cellCount: number): Promise<void> => {
  const saved = await instance.save();
  const table = findTable(saved.blocks);
  const tableId = table.id ?? '';
  const cells = gridIds(table);

  expect(cells).toHaveLength(cellCount);

  const docTable = findTable(docBlocks());

  expect(docTable.content).toEqual(cells);
  expect(table.content).toEqual(cells);
  expect(instance.blocks.getById(tableId)?.contentIds).toEqual(cells);

  for (const cellId of cells) {
    expect(instance.blocks.getById(cellId)?.parentId).toBe(tableId);
    expect(saved.blocks.find(block => block.id === cellId)?.parent).toBe(tableId);
    expect(docBlocks().find(block => block.id === cellId)?.parent).toBe(tableId);
  }

  // A peer or a reload builds the doc from the saved JSON: nothing may move.
  const store = new DocumentStore(new YBlockSerializer());

  store.fromJSON(saved.blocks);

  const peer = new DocumentStore(new YBlockSerializer());

  peer.applyRemoteUpdate(store.encodeStateAsUpdate());

  const shape = (blocks: OutputBlockData[]): Array<Pick<OutputBlockData, 'id' | 'parent' | 'content'>> =>
    blocks.map(({ id, parent, content }) => ({ id, parent, content }));

  expect(shape(peer.toJSON())).toEqual(shape(saved.blocks));
  expect(gridIds(findTable(peer.toJSON()))).toEqual(cells);
};

const cellParagraph = (id: string): OutputBlockData => ({ id, type: 'paragraph', data: { text: id }, parent: 'tbl' });

const savedTable = (withContent: boolean): OutputBlockData[] => [
  {
    id: 'tbl',
    type: 'table',
    data: { withHeadings: false, content: [[{ blocks: ['c1'] }, { blocks: ['c2'] }], [{ blocks: ['c3'] }, { blocks: ['c4'] }]] },
    ...(withContent ? { content: ['c1', 'c2', 'c3', 'c4'] } : {}),
  },
  cellParagraph('c1'),
  cellParagraph('c2'),
  cellParagraph('c3'),
  cellParagraph('c4'),
  { id: 'after', type: 'paragraph', data: { text: 'after' } },
];

describe('table cell blocks are children of the table in memory, saved JSON and the Yjs doc', () => {
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

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    capturedYjs = undefined;
    vi.restoreAllMocks();
  });

  it('lists cells created from legacy `text` cells', async () => {
    const instance = await boot([
      {
        id: 'tbl',
        type: 'table',
        data: {
          withHeadings: false,
          content: [[{ blocks: [], text: 'a1' }, { blocks: [], text: 'a2' }], [{ blocks: [], text: 'b1' }, { blocks: [], text: 'b2' }]],
        },
      },
      { id: 'after', type: 'paragraph', data: { text: 'after' } },
    ]);

    await expectCellsListedInEveryLayer(instance, 4);
  });

  it('lists cells of a saved table that carries `content`', async () => {
    await expectCellsListedInEveryLayer(await boot(savedTable(true)), 4);
  });

  it('lists cells of a saved table without `content`', async () => {
    await expectCellsListedInEveryLayer(await boot(savedTable(false)), 4);
  });

  it('lists cells of a table inserted through the API', async () => {
    const instance = await boot([
      { id: 'before', type: 'paragraph', data: { text: 'before' } },
      { id: 'after', type: 'paragraph', data: { text: 'after' } },
    ]);

    instance.blocks.insert('table', { content: [['x', 'y'], ['z', 'w']] }, {}, 1);
    await settle();

    await expectCellsListedInEveryLayer(instance, 4);
  });

  it('lists the cells of an added row', async () => {
    const instance = await boot(savedTable(true));
    const addRow = holder?.querySelector<HTMLElement>('[data-blok-table-add-row]');

    if (addRow === null || addRow === undefined) {
      throw new Error('no add-row button');
    }
    // jsdom has no pointer capture.
    addRow.setPointerCapture = vi.fn();
    addRow.releasePointerCapture = vi.fn();
    addRow.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    addRow.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    await settle();

    await expectCellsListedInEveryLayer(instance, 6);
  });
});
