import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import type { TableData, TableConfig } from '../../../../src/tools/table/types';
import { isCellWithBlocks } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions } from '../../../../types';

const createMockAPI = (): API => {
  return {
    styles: {
      block: 'blok-block',
      inlineToolbar: 'blok-inline-toolbar',
      inlineToolButton: 'blok-inline-tool-button',
      inlineToolButtonActive: 'blok-inline-tool-button--active',
      input: 'blok-input',
      loader: 'blok-loader',
      button: 'blok-button',
      settingsButton: 'blok-settings-button',
      settingsButtonActive: 'blok-settings-button--active',
    },
    i18n: {
      t: (key: string) => key,
    },
    blocks: {
      delete: () => {},
      insert: () => {
        const holder = document.createElement('div');

        holder.setAttribute('data-blok-id', `mock-${Math.random().toString(36).slice(2, 8)}`);

        return { id: `mock-${Math.random().toString(36).slice(2, 8)}`, holder };
      },
      getCurrentBlockIndex: () => 0,
      getBlocksCount: () => 0,
      getBlockIndex: () => undefined,
      setBlockParent: vi.fn(),
    },
    events: {
      on: vi.fn(),
      off: vi.fn(),
    },
  } as unknown as API;
};

const createTableOptions = (
  data: Partial<TableData> = {},
  config: TableConfig = {}
): BlockToolConstructorOptions<TableData, TableConfig> => ({
  data: { withHeadings: false, withHeadingColumn: false, content: [], ...data } as TableData,
  config,
  api: createMockAPI(),
  readOnly: false,
  block: {} as never,
});

describe('Table Tool – ragged rows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates enough columns for the widest row in ragged content', () => {
    const options = createTableOptions({
      content: [['a'], ['b', 'c']],
    });
    const table = new Table(options);
    const element = table.render();

    const rows = element.querySelectorAll('[data-blok-table-row]');

    expect(rows).toHaveLength(2);

    // The grid should have 2 columns (the max row length), not 1
    const firstRowCells = rows[0].querySelectorAll('[data-blok-table-cell]');
    const secondRowCells = rows[1].querySelectorAll('[data-blok-table-cell]');

    expect(firstRowCells).toHaveLength(2);
    expect(secondRowCells).toHaveLength(2);
  });

  it('preserves all cell data in the widest row after rendered() with ragged content', () => {
    const options = createTableOptions({
      content: [['a'], ['b', 'c']],
    });
    const table = new Table(options);
    const element = table.render();

    table.rendered();

    const saved = table.save(element);

    // The model should have 2 rows
    expect(saved.content).toHaveLength(2);

    // Row 1 (the widest) should have 2 cells, both with blocks — "c" is NOT lost
    expect(saved.content[1]).toHaveLength(2);
    saved.content[1].forEach(cell => {
      expect(isCellWithBlocks(cell)).toBe(true);
      if (isCellWithBlocks(cell)) {
        expect(cell.blocks.length).toBeGreaterThanOrEqual(1);
      }
    });

    // Row 0 should have at least 1 cell with blocks for "a"
    expect(saved.content[0].length).toBeGreaterThanOrEqual(1);
    const firstCell = saved.content[0][0];

    expect(isCellWithBlocks(firstCell)).toBe(true);
    if (isCellWithBlocks(firstCell)) {
      expect(firstCell.blocks.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('uses the max row length when later rows are wider', () => {
    const options = createTableOptions({
      content: [['a', 'b'], ['c', 'd', 'e'], ['f']],
    });
    const table = new Table(options);
    const element = table.render();

    const rows = element.querySelectorAll('[data-blok-table-row]');

    expect(rows).toHaveLength(3);

    // All rows should have 3 columns (the max)
    for (const row of Array.from(rows)) {
      const cells = row.querySelectorAll('[data-blok-table-cell]');

      expect(cells).toHaveLength(3);
    }
  });

  it('handles single-row content normally', () => {
    const options = createTableOptions({
      content: [['x', 'y', 'z']],
    });
    const table = new Table(options);
    const element = table.render();

    const rows = element.querySelectorAll('[data-blok-table-row]');

    expect(rows).toHaveLength(1);

    const cells = rows[0].querySelectorAll('[data-blok-table-cell]');

    expect(cells).toHaveLength(3);
  });

  it('falls back to config cols when content is empty', () => {
    const options = createTableOptions({ content: [] }, { cols: 5, rows: 2 });
    const table = new Table(options);
    const element = table.render();

    const rows = element.querySelectorAll('[data-blok-table-row]');

    expect(rows).toHaveLength(2);

    const cells = rows[0].querySelectorAll('[data-blok-table-cell]');

    expect(cells).toHaveLength(5);
  });
});
