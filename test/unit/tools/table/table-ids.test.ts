import { describe, it, expect } from 'vitest';
import { alignRowsToColumns, ensureTableIds } from '../../../../src/tools/table/table-ids';
import type { CellContent } from '../../../../src/tools/table/types';

const columnIds = (grid: CellContent[][]): (string | undefined)[][] =>
  grid.map(row => row.map(cell => cell.id));

const rowIds = (grid: CellContent[][]): (string | undefined)[][] =>
  grid.map(row => row.map(cell => cell.rowId));

describe('ensureTableIds', () => {
  it('gives every column one id shared by all its cells, and distinct ids per column', () => {
    const grid = ensureTableIds([
      [{ blocks: ['a'] }, { blocks: ['b'] }],
      [{ blocks: ['c'] }, { blocks: ['d'] }],
    ]);

    const [first, second] = grid[0].map(cell => cell.id);

    expect(first).toEqual(expect.any(String));
    expect(second).toEqual(expect.any(String));
    expect(first).not.toBe(second);
    expect(columnIds(grid)).toEqual([[first, second], [first, second]]);
  });

  it('gives every row one id shared by all its cells, and distinct ids per row', () => {
    const grid = ensureTableIds([
      [{ blocks: [] }, { blocks: [] }],
      [{ blocks: [] }, { blocks: [] }],
    ]);

    const first = grid[0][0].rowId;
    const second = grid[1][0].rowId;

    expect(first).toEqual(expect.any(String));
    expect(first).not.toBe(second);
    expect(rowIds(grid)).toEqual([[first, first], [second, second]]);
  });

  it('keeps ids that are already there', () => {
    const grid = ensureTableIds([
      [{ blocks: [], id: 'c1', rowId: 'r1' }, { blocks: [], id: 'c2', rowId: 'r1' }],
    ]);

    expect(columnIds(grid)).toEqual([['c1', 'c2']]);
    expect(rowIds(grid)).toEqual([['r1', 'r1']]);
  });

  it('spreads a column id to the cells of that column that lack it', () => {
    const grid = ensureTableIds([
      [{ blocks: [], id: 'c1', rowId: 'r1' }],
      [{ blocks: [], rowId: 'r2' }],
    ]);

    expect(columnIds(grid)).toEqual([['c1'], ['c1']]);
  });

  it('re-mints a column id that an earlier column already uses', () => {
    const grid = ensureTableIds([
      [{ blocks: [], id: 'dup', rowId: 'r1' }, { blocks: [], id: 'dup', rowId: 'r1' }],
    ]);

    expect(grid[0][0].id).toBe('dup');
    expect(grid[0][1].id).not.toBe('dup');
  });

  it('re-mints a row id that an earlier row already uses (a duplicated row)', () => {
    const grid = ensureTableIds([
      [{ blocks: [], id: 'c1', rowId: 'dup' }],
      [{ blocks: [], id: 'c1', rowId: 'dup' }],
    ]);

    expect(grid[0][0].rowId).toBe('dup');
    expect(grid[1][0].rowId).not.toBe('dup');
  });

  it('mints ids from the URL-safe alphabet only, so the HTML sanitizer never rewrites them', () => {
    const grid = ensureTableIds([[{ blocks: [] }]]);

    expect(grid[0][0].id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(grid[0][0].rowId).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('alignRowsToColumns', () => {
  const ids = (row: CellContent[]): (string | undefined)[] => row.map(cell => cell.id);

  it('puts an empty cell where a row lacks a column, instead of at the end', () => {
    const grid = alignRowsToColumns([
      [{ blocks: ['a0'], id: 'c0' }, { blocks: ['aN'], id: 'cN' }, { blocks: ['a1'], id: 'c1' }],
      [{ blocks: ['b0'], id: 'c0' }, { blocks: ['b1'], id: 'c1' }],
    ]);

    expect(grid[1]).toEqual([{ blocks: ['b0'], id: 'c0' }, { blocks: [], id: 'cN' }, { blocks: ['b1'], id: 'c1' }]);
  });

  it('reorders a row whose cells are in another column order', () => {
    const grid = alignRowsToColumns([
      [{ blocks: [], id: 'c0' }, { blocks: [], id: 'c1' }],
      [{ blocks: ['x'], id: 'c1' }, { blocks: ['y'], id: 'c0' }],
    ]);

    expect(ids(grid[1])).toEqual(['c0', 'c1']);
    expect(grid[1][0].blocks).toEqual(['y']);
  });

  it('leaves a row alone when it carries an id the widest row does not know', () => {
    const row = [{ blocks: ['x'], id: 'other' }];
    const grid = alignRowsToColumns([[{ blocks: [], id: 'c0' }, { blocks: [], id: 'c1' }], row]);

    expect(grid[1]).toEqual(row);
  });

  it('leaves a grid without column ids alone', () => {
    const input = [[{ blocks: ['a'] }], [{ blocks: ['b'] }, { blocks: ['c'] }]];

    expect(alignRowsToColumns(input)).toEqual(input);
  });
});
