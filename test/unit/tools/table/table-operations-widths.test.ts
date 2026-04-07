import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { BORDER_WIDTH, ROW_ATTR, CELL_ATTR } from '../../../../src/tools/table/table-core';
import { readPixelWidths, applyPixelWidths } from '../../../../src/tools/table/table-operations';

/**
 * Build a <table> with <colgroup>/<col>/<tbody>/<tr>/<td>.
 */
const createTableGrid = (colWidthsPx: number[], rows = 1): HTMLTableElement => {
  const table = document.createElement('table');
  const colgroup = document.createElement('colgroup');

  colWidthsPx.forEach(w => {
    const col = document.createElement('col');

    col.style.width = `${w}px`;
    colgroup.appendChild(col);
  });
  table.appendChild(colgroup);

  const tbody = document.createElement('tbody');

  Array.from({ length: rows }).forEach(() => {
    const tr = document.createElement('tr');

    tr.setAttribute(ROW_ATTR, '');
    colWidthsPx.forEach(() => {
      const td = document.createElement('td');

      td.setAttribute(CELL_ATTR, '');
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  return table;
};

describe('readPixelWidths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads widths from <col> elements', () => {
    const table = createTableGrid([100, 200, 150]);

    const widths = readPixelWidths(table);

    expect(widths).toEqual([100, 200, 150]);
  });

  it('returns empty array when no colgroup exists', () => {
    const table = document.createElement('table');
    const tbody = document.createElement('tbody');
    const tr = document.createElement('tr');

    tr.setAttribute(ROW_ATTR, '');
    const td = document.createElement('td');

    td.setAttribute(CELL_ATTR, '');
    tr.appendChild(td);
    tbody.appendChild(tr);
    table.appendChild(tbody);

    const widths = readPixelWidths(table);

    expect(widths).toEqual([]);
  });

  it('parses numeric values from px strings', () => {
    const table = createTableGrid([123.45, 67.89]);

    const widths = readPixelWidths(table);

    expect(widths).toEqual([123.45, 67.89]);
  });
});

describe('applyPixelWidths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets widths on <col> elements', () => {
    const table = createTableGrid([50, 50, 50]);

    applyPixelWidths(table, [120, 180, 200]);

    const cols = table.querySelectorAll('colgroup col');

    expect((cols[0] as HTMLElement).style.width).toBe('120px');
    expect((cols[1] as HTMLElement).style.width).toBe('180px');
    expect((cols[2] as HTMLElement).style.width).toBe('200px');
  });

  it('sets grid total width including border', () => {
    const table = createTableGrid([100, 200]);

    applyPixelWidths(table, [100, 200]);

    expect(table.style.width).toBe(`${300 + BORDER_WIDTH}px`);
  });

  it('does NOT set width on cells', () => {
    const table = createTableGrid([100, 200], 2);

    applyPixelWidths(table, [150, 250]);

    const cells = table.querySelectorAll(`[${CELL_ATTR}]`);

    cells.forEach(cell => {
      expect((cell as HTMLElement).style.width).toBe('');
    });
  });

  it('handles missing colgroup gracefully', () => {
    const table = document.createElement('table');
    const tbody = document.createElement('tbody');
    const tr = document.createElement('tr');

    tr.setAttribute(ROW_ATTR, '');
    const td = document.createElement('td');

    td.setAttribute(CELL_ATTR, '');
    tr.appendChild(td);
    tbody.appendChild(tr);
    table.appendChild(tbody);

    // Should not throw
    expect(() => applyPixelWidths(table, [100])).not.toThrow();

    // Total width should still be set on the grid element
    expect(table.style.width).toBe(`${100 + BORDER_WIDTH}px`);
  });
});
