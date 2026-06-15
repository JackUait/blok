import { describe, it, expect } from 'vitest';
import { TableModel } from '../../../../src/tools/table/table-model';
import type { TableData } from '../../../../src/tools/table/types';

/**
 * Regression for M1: merging absorbs cells and splitting frees them, but the
 * cell color / text color were never scrubbed. A color set on a cell before it
 * was absorbed reappeared on the freed cell after split — a value the user
 * never set on the now-visible cell.
 */
describe('TableModel scrubs color on merge and split', () => {
  const plain = (): TableData => ({
    withHeadings: false,
    withHeadingColumn: false,
    content: [
      [{ blocks: [] }, { blocks: [] }],
      [{ blocks: [] }, { blocks: [] }],
    ],
  });

  it('clears color/textColor from absorbed cells when merging', () => {
    const model = new TableModel(plain());

    model.setCellColor(0, 1, '#ff0000');
    model.setCellTextColor(0, 1, '#0000ff');

    model.mergeCells({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

    const absorbed = model.snapshot().content[0][1] as { color?: string; textColor?: string };

    expect(absorbed.color).toBeUndefined();
    expect(absorbed.textColor).toBeUndefined();
  });

  it('does not resurrect a stale color on a freed cell after split', () => {
    const model = new TableModel(plain());

    model.setCellColor(0, 1, '#ff0000');

    model.mergeCells({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });
    model.splitCell(0, 0);

    expect(model.getCellColor(0, 1)).toBeUndefined();
    const freed = model.snapshot().content[0][1] as { color?: string };

    expect(freed.color).toBeUndefined();
  });
});
