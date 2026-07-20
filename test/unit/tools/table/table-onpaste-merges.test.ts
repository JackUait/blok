import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import { CELL_ROW_ATTR, CELL_COL_ATTR } from '../../../../src/tools/table/table-core';
import { isCellWithBlocks } from '../../../../src/tools/table/types';
import type { CellContent, TableData, TableConfig } from '../../../../src/tools/table/types';
import { SanitizerConfigBuilder } from '../../../../src/components/modules/paste/sanitizer-config';
import type { BlockToolAdapter } from '../../../../src/components/tools/block';
import type { ToolsCollection } from '../../../../src/components/tools/collection';
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
      insert: (_tool?: string, data?: { text?: string }) => {
        const holder = document.createElement('div');
        const id = `mock-${Math.random().toString(36).slice(2, 8)}`;

        holder.setAttribute('data-blok-id', id);
        holder.textContent = data?.text ?? '';

        return { id, holder };
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
  data: { withHeadings: false, withHeadingColumn: false, content: [], ...data },
  config,
  api: createMockAPI(),
  readOnly: false,
  block: {} as never,
});

const createPasteTable = (html: string): HTMLTableElement => {
  const tableEl = document.createElement('table');

  tableEl.innerHTML = html;

  return tableEl;
};

const firePasteEvent = (table: Table, element: HTMLElement): void => {
  const event = {
    detail: { data: element },
  } as unknown as CustomEvent;

  table.onPaste(event);
};

/**
 * Paste `html` into a fresh table and return the saved data plus the live
 * wrapper element produced by onPaste (already swapped into the document).
 */
const pasteAndSave = (html: string): { saved: TableData; wrapper: HTMLElement; cleanup: () => void } => {
  const table = new Table(createTableOptions({ content: [['A']] }));
  const element = table.render();

  document.body.appendChild(element);
  table.rendered();

  firePasteEvent(table, createPasteTable(html));

  // onPaste replaces the original element in-place; find the live wrapper
  const wrapper = document.querySelector<HTMLElement>('[data-blok-tool="table"]');

  if (!wrapper) {
    throw new Error('table wrapper not found after paste');
  }

  const saved = table.save(wrapper);

  return {
    saved,
    wrapper,
    cleanup: () => {
      wrapper.remove();
    },
  };
};

const cellAt = (saved: TableData, row: number, col: number): CellContent => {
  const cell = saved.content[row]?.[col];

  if (cell === undefined || !isCellWithBlocks(cell)) {
    throw new Error(`no cell content at [${row}][${col}]`);
  }

  return cell;
};

/** Text of the rendered cell at the given LOGICAL coordinates. */
const cellText = (wrapper: HTMLElement, row: number, col: number): string | null => {
  const cell = wrapper.querySelector(`[${CELL_ROW_ATTR}="${row}"][${CELL_COL_ATTR}="${col}"]`);

  return cell === null ? null : (cell.textContent ?? '').trim();
};

describe('Table onPaste merged cells (colspan/rowspan)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('preserves a colspan merge from pasted HTML', () => {
    const { saved, cleanup } = pasteAndSave([
      '<tr><td colspan="2">Merged</td><td>C</td></tr>',
      '<tr><td>1</td><td>2</td><td>3</td></tr>',
    ].join(''));

    expect(saved.content).toHaveLength(2);
    expect(saved.content[0]).toHaveLength(3);
    expect(cellAt(saved, 0, 0).colspan).toBe(2);
    expect(cellAt(saved, 0, 1).mergedInto).toEqual([0, 0]);
    expect(cellAt(saved, 0, 2).mergedInto).toBeUndefined();

    cleanup();
  });

  it('preserves a rowspan merge and keeps later-row cells at correct logical columns', () => {
    const { saved, wrapper, cleanup } = pasteAndSave([
      '<tr><td rowspan="2">Tall</td><td>B1</td><td>C1</td></tr>',
      '<tr><td>B2</td><td>C2</td></tr>',
    ].join(''));

    expect(cellAt(saved, 0, 0).rowspan).toBe(2);
    expect(cellAt(saved, 1, 0).mergedInto).toEqual([0, 0]);

    // Physical cell 0 of row 2 is LOGICAL column 1 — the pre-fix flattening
    // shifted these one column to the left.
    expect(cellText(wrapper, 1, 1)).toBe('B2');
    expect(cellText(wrapper, 1, 2)).toBe('C2');

    cleanup();
  });

  it('renders colspan/rowspan attributes on the pasted grid DOM', () => {
    const { wrapper, cleanup } = pasteAndSave([
      '<tr><td colspan="2" rowspan="2">Big</td><td>C1</td></tr>',
      '<tr><td>C2</td></tr>',
      '<tr><td>A3</td><td>B3</td><td>C3</td></tr>',
    ].join(''));

    const origin = wrapper.querySelector(`[${CELL_ROW_ATTR}="0"][${CELL_COL_ATTR}="0"]`);

    expect(origin?.getAttribute('colspan')).toBe('2');
    expect(origin?.getAttribute('rowspan')).toBe('2');
    // Covered slots must not render their own cells
    expect(wrapper.querySelector(`[${CELL_ROW_ATTR}="0"][${CELL_COL_ATTR}="1"]`)).toBeNull();
    expect(wrapper.querySelector(`[${CELL_ROW_ATTR}="1"][${CELL_COL_ATTR}="0"]`)).toBeNull();
    expect(cellText(wrapper, 2, 1)).toBe('B3');

    cleanup();
  });

  it('reproduces a Google-Docs-style header layout (mixed row/col spans)', () => {
    // Mirrors the reported table: "Месяц | Май 2026(colspan)" over
    // "Вакансия(rowspan) | Анкеты | Вышедшие(colspan 3) | Конверсия(rowspan)"
    const { saved, wrapper, cleanup } = pasteAndSave([
      '<tr><td>Month</td><td colspan="5">May 2026</td></tr>',
      '<tr><td rowspan="2">Vacancy</td><td>Forms</td><td colspan="3">Hired</td><td rowspan="2">Conversion</td></tr>',
      '<tr><td>fact</td><td>goal</td><td>fact</td><td>result</td></tr>',
      '<tr><td>Cashier</td><td>6466</td><td>125</td><td>188</td><td>150%</td><td>2,9%</td></tr>',
    ].join(''));

    expect(saved.content[0]).toHaveLength(6);
    expect(cellAt(saved, 0, 1).colspan).toBe(5);
    expect(cellAt(saved, 1, 0).rowspan).toBe(2);
    expect(cellAt(saved, 1, 2).colspan).toBe(3);
    expect(cellAt(saved, 1, 5).rowspan).toBe(2);
    expect(cellAt(saved, 2, 0).mergedInto).toEqual([1, 0]);

    // Third physical row starts at logical column 1 (under the rowspan)
    expect(cellText(wrapper, 2, 1)).toBe('fact');
    expect(cellText(wrapper, 2, 4)).toBe('result');
    // Data row is unshifted
    expect(cellText(wrapper, 3, 0)).toBe('Cashier');
    expect(cellText(wrapper, 3, 5)).toBe('2,9%');

    cleanup();
  });

  it('places cell colors at logical coordinates when spans shift physical positions', () => {
    const { saved, cleanup } = pasteAndSave([
      '<tr><td rowspan="2">Tall</td><td>B1</td></tr>',
      '<tr><td style="background-color: #fbecdd">B2</td></tr>',
    ].join(''));

    // The colored cell is physical index 0 of row 2 but LOGICAL column 1
    expect(cellAt(saved, 1, 1).color).toBe('#fbecdd');
    expect(cellAt(saved, 1, 0).color).toBeUndefined();

    cleanup();
  });

  it('clamps spans that overflow the actual grid', () => {
    const { saved, cleanup } = pasteAndSave([
      '<tr><td colspan="99">Wide</td><td>B</td></tr>',
      '<tr><td rowspan="99">Tall</td><td>X</td></tr>',
    ].join(''));

    const rows = saved.content.length;
    const cols = saved.content[0].length;

    saved.content.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (!isCellWithBlocks(cell)) {
          return;
        }

        expect(r + (cell.rowspan ?? 1)).toBeLessThanOrEqual(rows);
        expect(c + (cell.colspan ?? 1)).toBeLessThanOrEqual(cols);
      });
    });

    cleanup();
  });

  it('pastes span-free tables exactly as before (no merge metadata)', () => {
    const { saved, wrapper, cleanup } = pasteAndSave(
      '<tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr>'
    );

    saved.content.flat().forEach(cell => {
      if (!isCellWithBlocks(cell)) {
        return;
      }

      expect(cell.colspan).toBeUndefined();
      expect(cell.rowspan).toBeUndefined();
      expect(cell.mergedInto).toBeUndefined();
    });
    expect(cellText(wrapper, 1, 1)).toBe('D');

    cleanup();
  });
});

describe('Table pasteConfig sanitizer keeps span attributes', () => {
  it('clean() with the Table paste config preserves colspan/rowspan on td and th', () => {
    const builder = new SanitizerConfigBuilder(
      {} as unknown as ToolsCollection<BlockToolAdapter>,
      {}
    );
    const toolConfig = builder.buildToolConfig({
      pasteConfig: Table.pasteConfig,
    } as unknown as BlockToolAdapter);

    const tableEl = createPasteTable([
      '<tr><th colspan="2">Head</th><th>C</th></tr>',
      '<tr><td rowspan="2">Tall</td><td>B</td><td>C</td></tr>',
      '<tr><td>B2</td><td>C2</td></tr>',
    ].join(''));

    const sanitized = builder.sanitizeTable(tableEl, toolConfig);

    expect(sanitized).not.toBeNull();
    expect(sanitized?.querySelector('th')?.getAttribute('colspan')).toBe('2');
    expect(sanitized?.querySelector('td[rowspan]')?.getAttribute('rowspan')).toBe('2');
  });
});
