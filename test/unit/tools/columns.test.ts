import { describe, it, expect } from 'vitest';
import { Columns } from '../../../src/tools/columns';
import { Column } from '../../../src/tools/column';
import { ColumnList } from '../../../src/tools/column-list';

describe('Columns group manifest', () => {
  it('provides the column_list and column block tools', () => {
    expect(Columns.provides).toEqual({
      column_list: ColumnList,
      column: Column,
    });
  });

  it('is a registration handle, not a block tool (no toolbox)', () => {
    expect('toolbox' in Columns).toBe(false);
  });
});
