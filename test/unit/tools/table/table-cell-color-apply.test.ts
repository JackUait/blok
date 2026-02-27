import { describe, it, expect } from 'vitest';
import { applyCellColors } from '../../../../src/tools/table/table-operations';

const ROW_ATTR = 'data-blok-table-row';
const CELL_ATTR = 'data-blok-table-cell';

const createTestGrid = (rows: number, cols: number): HTMLElement => {
  const grid = document.createElement('div');

  for (let r = 0; r < rows; r++) {
    const row = document.createElement('div');

    row.setAttribute(ROW_ATTR, '');

    for (let c = 0; c < cols; c++) {
      const cell = document.createElement('div');

      cell.setAttribute(CELL_ATTR, '');
      row.appendChild(cell);
    }

    grid.appendChild(row);
  }

  return grid;
};

describe('applyCellColors', () => {
  it('applies background-color to cells with color in content', () => {
    const grid = createTestGrid(2, 2);
    const content = [
      [{ blocks: [], color: '#fbecdd' }, { blocks: [] }],
      [{ blocks: [] }, { blocks: [], color: '#e7f3f8' }],
    ];

    applyCellColors(grid, content);

    const rows = grid.querySelectorAll(`[${ROW_ATTR}]`);
    const cell00 = rows[0].querySelectorAll(`[${CELL_ATTR}]`)[0] as HTMLElement;
    const cell01 = rows[0].querySelectorAll(`[${CELL_ATTR}]`)[1] as HTMLElement;
    const cell10 = rows[1].querySelectorAll(`[${CELL_ATTR}]`)[0] as HTMLElement;
    const cell11 = rows[1].querySelectorAll(`[${CELL_ATTR}]`)[1] as HTMLElement;

    expect(cell00.style.backgroundColor).toBeTruthy();
    expect(cell01.style.backgroundColor).toBe('');
    expect(cell10.style.backgroundColor).toBe('');
    expect(cell11.style.backgroundColor).toBeTruthy();
  });

  it('clears background-color from cells without color', () => {
    const grid = createTestGrid(1, 1);
    const cell = grid.querySelector(`[${CELL_ATTR}]`) as HTMLElement;

    cell.style.backgroundColor = '#fbecdd';

    applyCellColors(grid, [[{ blocks: [] }]]);

    expect(cell.style.backgroundColor).toBe('');
  });

  it('applies text color to cells with textColor in content', () => {
    const grid = createTestGrid(2, 2);
    const content = [
      [{ blocks: [], textColor: '#787774' }, { blocks: [] }],
      [{ blocks: [] }, { blocks: [], textColor: '#d9730d' }],
    ];

    applyCellColors(grid, content);

    const rows = grid.querySelectorAll(`[${ROW_ATTR}]`);
    const cell00 = rows[0].querySelectorAll(`[${CELL_ATTR}]`)[0] as HTMLElement;
    const cell01 = rows[0].querySelectorAll(`[${CELL_ATTR}]`)[1] as HTMLElement;
    const cell10 = rows[1].querySelectorAll(`[${CELL_ATTR}]`)[0] as HTMLElement;
    const cell11 = rows[1].querySelectorAll(`[${CELL_ATTR}]`)[1] as HTMLElement;

    expect(cell00.style.color).toBeTruthy();
    expect(cell01.style.color).toBe('');
    expect(cell10.style.color).toBe('');
    expect(cell11.style.color).toBeTruthy();
  });

  it('clears text color from cells without textColor', () => {
    const grid = createTestGrid(1, 1);
    const cell = grid.querySelector(`[${CELL_ATTR}]`) as HTMLElement;

    cell.style.color = '#787774';

    applyCellColors(grid, [[{ blocks: [] }]]);

    expect(cell.style.color).toBe('');
  });

  it('applies both color and textColor together', () => {
    const grid = createTestGrid(1, 1);
    const content = [
      [{ blocks: [], color: '#fbecdd', textColor: '#d9730d' }],
    ];

    applyCellColors(grid, content);

    const cell = grid.querySelector(`[${CELL_ATTR}]`) as HTMLElement;

    expect(cell.style.backgroundColor).toBeTruthy();
    expect(cell.style.color).toBeTruthy();
  });
});
