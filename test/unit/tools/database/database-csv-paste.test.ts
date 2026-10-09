import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { csvDatabaseBlocks, pastedTable } from '../../../../src/tools/database/database-csv';

describe('pastedTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads tab-separated and comma-separated text with two or more rows and columns', () => {
    expect(pastedTable('Name\tPoints\nShip\t5\n')).toEqual([['Name', 'Points'], ['Ship', '5']]);
    expect(pastedTable('Name,Points\n"Write, edit",3')).toEqual([['Name', 'Points'], ['Write, edit', '3']]);
  });

  it('is not a table: one line, one column, or rows of different widths', () => {
    expect(pastedTable('Name,Points')).toBeNull();
    expect(pastedTable('just\nlines\nof text')).toBeNull();
    expect(pastedTable('a,b\nc')).toBeNull();
    expect(pastedTable('')).toBeNull();
  });

  describe('csvDatabaseBlocks', () => {
    it('builds a database block and one row block per line, title first, values parsed', () => {
      const ids = ['db', 'p1', 'p2', 'v1', 'r1', 'r2'];
      const built = csvDatabaseBlocks([['Task', 'Points'], ['Write', '3'], ['Ship', '5']], {
        newId: () => ids.shift() ?? 'x', untitled: 'Column', viewName: 'Table', title: 'Pasted',
      });

      expect(built.id).toBe('db');
      expect(built.data.title).toBe('Pasted');
      expect(built.data.schema.map((p) => [p.name, p.type])).toEqual([['Task', 'title'], ['Points', 'number']]);
      expect(built.data.views).toEqual([{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['p2'] }]);
      expect(built.data.activeViewId).toBe('v1');
      expect(built.rows.map((row) => [row.id, row.data.title, row.data.properties])).toEqual([
        ['r1', 'Write', { p1: 'Write', p2: 3 }],
        ['r2', 'Ship', { p1: 'Ship', p2: 5 }],
      ]);
      expect(built.rows[0].data.position < built.rows[1].data.position).toBe(true);
    });
  });
});
