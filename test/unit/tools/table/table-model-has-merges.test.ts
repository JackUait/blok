import { describe, it, expect } from 'vitest';
import { TableModel } from '../../../../src/tools/table/table-model';
import type { TableData } from '../../../../src/tools/table/types';

/**
 * hasMerges() is the table-wide guard used to disable physical-index row/col
 * reordering (H5/H6/H7) whenever any merge is present — a physical NodeList
 * move desyncs the DOM from the logical model on merged grids.
 */
describe('TableModel.hasMerges', () => {
  const make = (content: TableData['content']): TableModel =>
    new TableModel({ withHeadings: false, withHeadingColumn: false, content });

  it('returns false for a plain grid', () => {
    expect(make([[{ blocks: [] }, { blocks: [] }], [{ blocks: [] }, { blocks: [] }]]).hasMerges()).toBe(false);
  });

  it('returns true when a cell has colspan', () => {
    expect(
      make([
        [{ blocks: [], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
        [{ blocks: [] }, { blocks: [] }],
      ]).hasMerges()
    ).toBe(true);
  });

  it('returns true when a cell has rowspan', () => {
    expect(
      make([
        [{ blocks: [], rowspan: 2 }, { blocks: [] }],
        [{ blocks: [], mergedInto: [0, 0] }, { blocks: [] }],
      ]).hasMerges()
    ).toBe(true);
  });
});
