import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Table } from '../../../../src/tools/table';
import { mountCellBlocksReadOnly } from '../../../../src/tools/table/table-operations';
import type { API, OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  readOnly: API['readOnly'];
}

const INNER_IDS = ['i00', 'i01', 'i10', 'i11', 'i20', 'i21'];

const blocks: OutputBlockData[] = [
  {
    id: 'outer',
    type: 'table',
    data: {
      withHeadings: false,
      content: [
        [{ blocks: ['inner'] }, { blocks: ['top-right'] }],
        [{ blocks: ['bottom-left'] }, { blocks: ['bottom-right'] }],
      ],
    },
    content: ['inner', 'top-right', 'bottom-left', 'bottom-right'],
  },
  {
    id: 'inner',
    type: 'table',
    parent: 'outer',
    data: {
      withHeadings: false,
      content: [
        [{ blocks: ['i00'] }, { blocks: ['i01'] }],
        [{ blocks: ['i10'] }, { blocks: ['i11'] }],
        [{ blocks: ['i20'] }, { blocks: ['i21'] }],
      ],
    },
    content: INNER_IDS,
  },
  ...INNER_IDS.map(id => ({
    id,
    type: 'paragraph',
    parent: 'inner',
    data: { text: id },
  })),
  { id: 'top-right', type: 'paragraph', parent: 'outer', data: { text: 'top-right' } },
  { id: 'bottom-left', type: 'paragraph', parent: 'outer', data: { text: 'bottom-left' } },
  { id: 'bottom-right', type: 'paragraph', parent: 'outer', data: { text: 'bottom-right' } },
];

const nextFrame = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()));

describe('nested table in read-only mode', () => {
  let holder: HTMLDivElement;
  let editor: TestEditor | null = null;

  const grid = (id: string): HTMLTableElement => {
    const element = holder.querySelector<HTMLTableElement>(`[data-blok-id="${id}"] table`);

    if (!element) {
      throw new Error(`table ${id} is missing`);
    }

    return element;
  };

  // Returns the table cell (row, col) that directly holds the block's holder.
  const cellOf = (blockId: string): { table: HTMLTableElement | null; row: number; col: number } => {
    const blockHolder = holder.querySelector<HTMLElement>(`[data-blok-id="${blockId}"]`);
    const cell = blockHolder?.closest('td');
    const row = cell?.parentElement;
    const table = cell?.closest('table') ?? null;

    if (!cell || !(row instanceof HTMLTableRowElement)) {
      return { table, row: -1, col: -1 };
    }

    return { table, row: row.rowIndex, col: cell.cellIndex };
  };

  const expectBlocksInOwnCells = (): void => {
    expect(cellOf('bottom-left')).toEqual({ table: grid('outer'), row: 1, col: 0 });
    expect(cellOf('bottom-right')).toEqual({ table: grid('outer'), row: 1, col: 1 });
    expect(cellOf('top-right')).toEqual({ table: grid('outer'), row: 0, col: 1 });
    expect(grid('inner').closest('td')).toBe(grid('outer').rows[0].cells[0]);

    INNER_IDS.forEach(id => {
      expect(cellOf(id)).toEqual({ table: grid('inner'), row: Number(id[1]), col: Number(id[2]) });
      expect(grid('inner').rows[Number(id[1])].cells[Number(id[2])].querySelectorAll('[data-blok-id]')).toHaveLength(1);
    });
  };

  const expectSavedAsLoaded = async (instance: TestEditor): Promise<void> => {
    const saved = await instance.save();
    const cellIdsOf = (id: string): unknown => {
      const content: unknown = saved.blocks.find(block => block.id === id)?.data.content;

      return Array.isArray(content)
        ? content.map((row: unknown) => Array.isArray(row)
          ? row.map((cell: unknown) => typeof cell === 'object' && cell !== null && 'blocks' in cell ? cell.blocks : undefined)
          : undefined)
        : undefined;
    };

    expect(saved.blocks.map(block => block.id).sort()).toEqual(blocks.map(block => block.id).sort());
    expect(cellIdsOf('outer')).toEqual([['inner', 'top-right'], ['bottom-left', 'bottom-right']].map(row => row.map(id => [id])));
    expect(cellIdsOf('inner')).toEqual([['i00', 'i01'], ['i10', 'i11'], ['i20', 'i21']].map(row => row.map(id => [id])));
  };

  const boot = async (readOnly: boolean): Promise<TestEditor> => {
    const instance = new Blok({
      holder,
      readOnly,
      tools: { table: Table, paragraph: Paragraph },
      data: { blocks },
    }) as unknown as TestEditor;

    editor = instance;
    await instance.isReady;
    await nextFrame();
    await nextFrame();

    return instance;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = null;
    holder.remove();
    vi.restoreAllMocks();
  });

  it('keeps outer row-1 blocks in the outer table on a read-only boot', async () => {
    await boot(true);

    expectBlocksInOwnCells();
  });

  it('keeps every block in its own table when leaving a read-only boot', async () => {
    const instance = await boot(true);

    await instance.readOnly.set(false);
    await nextFrame();

    expectBlocksInOwnCells();
    await expectSavedAsLoaded(instance);
  });

  it('keeps every block in its own table when toggling read-only on and off', async () => {
    const instance = await boot(false);

    expectBlocksInOwnCells();

    await instance.readOnly.set(true);
    await nextFrame();

    expectBlocksInOwnCells();

    await instance.readOnly.set(false);
    await nextFrame();

    expectBlocksInOwnCells();
    await expectSavedAsLoaded(instance);
  });
});

describe('mountCellBlocksReadOnly with a nested table already in place', () => {
  const makeGrid = (rows: number, cols: number): HTMLTableElement => {
    const table = document.createElement('table');
    const body = table.createTBody();

    for (let r = 0; r < rows; r++) {
      const row = body.insertRow();

      row.setAttribute('data-blok-table-row', '');

      for (let c = 0; c < cols; c++) {
        const cell = row.insertCell();
        const container = document.createElement('div');

        cell.setAttribute('data-blok-table-cell', '');
        cell.setAttribute('data-blok-table-cell-col', String(c));
        container.setAttribute('data-blok-table-cell-blocks', '');
        cell.appendChild(container);
      }
    }

    return table;
  };

  const makeHolder = (id: string): HTMLElement => {
    const element = document.createElement('div');

    element.setAttribute('data-blok-id', id);

    return element;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('mounts outer content into outer cells, not the nested table cells', () => {
    const outerGrid = makeGrid(2, 2);
    const innerHolder = makeHolder('inner');
    const innerGrid = makeGrid(1, 2);

    innerHolder.appendChild(innerGrid);
    innerGrid.rows[0].cells[0].firstElementChild?.appendChild(makeHolder('i00'));
    innerGrid.rows[0].cells[1].firstElementChild?.appendChild(makeHolder('i01'));
    outerGrid.rows[0].cells[0].firstElementChild?.appendChild(innerHolder);
    document.body.appendChild(outerGrid);

    const holders = new Map<string, HTMLElement>([
      ['inner', innerHolder],
      ['top-right', makeHolder('top-right')],
      ['bottom-left', makeHolder('bottom-left')],
      ['bottom-right', makeHolder('bottom-right')],
    ]);
    const ids = Array.from(holders.keys());
    const api = {
      blocks: {
        getBlockIndex: (id: string): number | undefined => {
          const index = ids.indexOf(id);

          return index < 0 ? undefined : index;
        },
        getBlockByIndex: (index: number) => ({ holder: holders.get(ids[index]), parentId: 'outer' }),
      },
    } as unknown as API;

    mountCellBlocksReadOnly(outerGrid, [
      [{ blocks: ['inner'] }, { blocks: ['top-right'] }],
      [{ blocks: ['bottom-left'] }, { blocks: ['bottom-right'] }],
    ], api, 'outer');

    expect(holders.get('bottom-left')?.closest('td')).toBe(outerGrid.rows[1].cells[0]);
    expect(holders.get('bottom-right')?.closest('td')).toBe(outerGrid.rows[1].cells[1]);
    expect(holders.get('top-right')?.closest('td')).toBe(outerGrid.rows[0].cells[1]);
    expect(innerGrid.rows[0].cells[0].querySelector('[data-blok-id]')?.getAttribute('data-blok-id')).toBe('i00');
    expect(innerGrid.rows[0].cells[1].querySelector('[data-blok-id]')?.getAttribute('data-blok-id')).toBe('i01');
  });
});
