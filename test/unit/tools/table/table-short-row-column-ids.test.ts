import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import Blok from '../../../../src/blok';
import { Table } from '../../../../src/tools/table/index';
import { Paragraph } from '../../../../src/tools/paragraph';
import { normalizeTableData } from '../../../../src/tools/table/table-operations';
import type { CellContent, TableData } from '../../../../src/tools/table/types';
import type { OutputBlockData, OutputData } from '../../../../types';

const TABLE_ID = 'table-1';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
}

/** Row 1 missed column B: it carries ids A and C only, with f in C. */
const shortRowContent = (): CellContent[][] => [
  [
    { blocks: ['a'], id: 'A', rowId: 'r0' },
    { blocks: ['b'], id: 'B', rowId: 'r0' },
    { blocks: ['c'], id: 'C', rowId: 'r0' },
  ],
  [
    { blocks: ['d'], id: 'A', rowId: 'r1' },
    { blocks: ['f'], id: 'C', rowId: 'r1' },
  ],
];

const describeRow = (row: CellContent[]): string[] =>
  row.map(cell => `${cell.id}:${cell.blocks.join(',')}`);

describe('a short row that carries column ids', () => {
  let holder: HTMLElement;
  let blok: TestEditor | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
    blok = null;
  });

  afterEach(() => {
    blok?.destroy();
    blok = null;
    holder.remove();
    vi.restoreAllMocks();
  });

  it('keeps each cell in its own column when normalized', () => {
    const normalized = normalizeTableData({ withHeadings: false, withHeadingColumn: false, content: shortRowContent() }, {});
    const rows = normalized.content.map(row => row as CellContent[]);

    expect(describeRow(rows[1])).toEqual(['A:d', 'B:', 'C:f']);
    expect(describeRow(rows[0])).toEqual(['A:a', 'B:b', 'C:c']);
  });

  // A full editor boot; the default 5s is too tight on a loaded machine.
  it('keeps each cell in its own column through a load and save', async () => {
    const texts: Record<string, string> = { a: 'a', b: 'b', c: 'c', d: 'd', f: 'f' };
    const table: OutputBlockData = {
      id: TABLE_ID,
      type: 'table',
      data: { withHeadings: false, content: shortRowContent() },
    };
    const cells: OutputBlockData[] = Object.keys(texts).map(id => ({
      id,
      type: 'paragraph',
      data: { text: texts[id] },
      parent: TABLE_ID,
    }));
    const data: OutputData = { blocks: [table, ...cells] };

    blok = new Blok({ holder, tools: { table: Table, paragraph: Paragraph }, data }) as unknown as TestEditor;
    await blok.isReady;

    const saved = await blok.save();
    const savedTable = saved.blocks.find((block: OutputBlockData) => block.type === 'table');
    const content = (savedTable?.data as TableData).content.map(row => row as CellContent[]);
    const textOf = (id: string): string => {
      const text: unknown = saved.blocks.find((block: OutputBlockData) => block.id === id)?.data.text;

      return typeof text === 'string' ? text : '';
    };
    const row1 = content[1].map(cell => `${cell.id}:${cell.blocks.map(textOf).join(',')}`);

    expect(row1).toEqual(['A:d', 'B:', 'C:f']);
  }, 30_000);
});
