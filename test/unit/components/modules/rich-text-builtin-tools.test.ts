/**
 * Built-in tools keep working now that rich text saves as segments.
 * Host-facing reads (`BlockAPI.save`, `getBlockData`) hand out segment arrays;
 * tools read other blocks through internal data, which stays HTML.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { Header } from '../../../../src/tools/header';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Table } from '../../../../src/tools/table';
import { toClipboardBlock } from '../../../../src/tools/table/table-cell-blocks';
import type { API, BlokConfig, OutputBlockData, OutputData } from '../../../../types';
import type { BlockToolConstructable } from '../../../../types/tools';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
}

const editors: TestEditor[] = [];
const holders: HTMLElement[] = [];

const createEditor = async (config: Partial<BlokConfig>): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  holders.push(holder);

  const editor = new Blok({
    holder,
    tools: {
      paragraph: Paragraph,
      header: Header as unknown as BlockToolConstructable,
      table: Table as unknown as BlockToolConstructable,
      database: DatabaseTool as unknown as BlockToolConstructable,
      'database-row': DatabaseRowTool as unknown as BlockToolConstructable,
    },
    ...config,
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

const bold = [{ text: 'a', marks: { bold: true } }];

const tableWithBoldCells = (): OutputBlockData[] => [
  { id: 't', type: 'table', data: { withHeadings: false, content: [[{ id: 'k1', rowId: 'r1', blocks: ['c1'] }, { id: 'k2', rowId: 'r1', blocks: ['c2'] }]] } },
  { id: 'c1', type: 'paragraph', data: { text: '<b>a</b>' }, parent: 't' },
  { id: 'c2', type: 'paragraph', data: { text: 'plain' }, parent: 't' },
];

const databaseWithNotes = (notes: unknown): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      title: 'Tasks',
      schema: [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-notes', name: 'Notes', type: 'richText', position: 'a1' },
      ],
      views: [{ id: 'v-list', name: 'List', type: 'list', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v-list',
    },
    content: ['r1'],
  },
  {
    id: 'r1',
    type: 'database-row',
    data: { properties: { 'p-title': 'one', 'p-notes': { blocks: [{ type: 'paragraph', data: { text: notes } }] } }, position: 'a0', title: 'one' },
    parent: 'db',
  },
];

const notesText = (data: unknown): unknown => {
  const properties = (data as { properties?: Record<string, { blocks?: Array<{ data: { text: unknown } }> }> } | undefined)?.properties;

  return properties?.['p-notes']?.blocks?.[0]?.data.text;
};

const blockData = (saved: OutputData, id: string): Record<string, unknown> | undefined =>
  saved.blocks.find(block => block.id === id)?.data;

describe('built-in tools — rich text segments', { timeout: 60_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    editors.splice(0).forEach(editor => editor.destroy());
    holders.splice(0).forEach(holder => holder.remove());
    vi.restoreAllMocks();
  });

  it('a table saves its formatted cell paragraphs as segments and keeps its grid', async () => {
    const saved = await (await createEditor({ data: { blocks: tableWithBoldCells() } })).save();

    expect(blockData(saved, 'c1')?.text).toEqual(bold);
    expect(blockData(saved, 'c2')?.text).toEqual([{ text: 'plain' }]);
    // The grid as the HTML output saved it.
    expect(blockData(saved, 't')).toEqual({
      withHeadings: false,
      withHeadingColumn: false,
      stretched: false,
      content: [[{ blocks: ['c1'], id: 'k1', rowId: 'r1' }, { blocks: ['c2'], id: 'k2', rowId: 'r1' }]],
      initialColWidth: 0,
    });
  });

  it('copying a table cell block carries HTML', async () => {
    const editor = await createEditor({ data: { blocks: tableWithBoldCells() } });

    const copy = (editor: TestEditor): unknown => {
      const cell = editor.blocks.getById('c1');

      if (cell === null) {
        throw new Error('cell paragraph c1 is missing');
      }

      return toClipboardBlock(editor as unknown as API, cell).data;
    };

    expect(copy(editor)).toEqual({ text: '<strong>a</strong>' });
  });

  it('turning a bold paragraph into a heading keeps the bold text', async () => {
    const blocks = [{ id: 'p1', type: 'paragraph', data: { text: '<b>a</b>' } }];
    const editor = await createEditor({ data: { blocks } });

    await editor.blocks.convert('p1', 'header', { level: 2 });

    expect((await editor.save()).blocks[0]).toMatchObject({ type: 'header', data: { text: bold, level: 2 } });
  });

  it('a database row given segment notes keeps them as HTML inside and hands the host segments', async () => {
    const editor = await createEditor({ data: { blocks: databaseWithNotes(bold) } });

    // The card body editor reads this document as-is, so it must be HTML.
    expect(notesText(editor.blocks.getById('r1')?.preservedData)).toBe('<strong>a</strong>');
    expect(notesText(blockData(await editor.save(), 'r1'))).toEqual(bold);
  });
});
