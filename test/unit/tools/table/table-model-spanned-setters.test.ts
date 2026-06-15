import { describe, it, expect } from 'vitest';
import { TableModel } from '../../../../src/tools/table/table-model';
import type { TableData } from '../../../../src/tools/table/types';

/**
 * Defense-in-depth for H3: the color / text-color / placement setters must
 * refuse to write to a SPANNED (merge-covered) coordinate, mirroring the
 * guards already present on addBlockToCell / setCellBlocks. Without this, a
 * stray physical-index write would leave a value on a hidden cell that the
 * logical read-back never sees, then resurfaces on merge/split.
 */
describe('TableModel color/placement setters reject spanned cells', () => {
  /** 2x3 with row-0 cols 0+1 merged; (0,1) is spanned. */
  const data = (): TableData => ({
    withHeadings: false,
    withHeadingColumn: false,
    content: [
      [{ blocks: [], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }, { blocks: [] }],
      [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
    ],
  });

  it('setCellColor is a no-op on a spanned cell', () => {
    const model = new TableModel(data());

    model.setCellColor(0, 1, '#ff0000');

    expect(model.getCellColor(0, 1)).toBeUndefined();
    const spanned = model.snapshot().content[0][1] as { color?: string };

    expect(spanned.color).toBeUndefined();
  });

  it('setCellTextColor is a no-op on a spanned cell', () => {
    const model = new TableModel(data());

    model.setCellTextColor(0, 1, '#00ff00');

    expect(model.getCellTextColor(0, 1)).toBeUndefined();
  });

  it('setCellPlacement is a no-op on a spanned cell', () => {
    const model = new TableModel(data());

    model.setCellPlacement(0, 1, 'middle-center');

    expect(model.getCellPlacement(0, 1)).toBeUndefined();
  });

  it('still writes color to a normal (non-spanned) cell', () => {
    const model = new TableModel(data());

    model.setCellColor(0, 2, '#0000ff');

    expect(model.getCellColor(0, 2)).toBe('#0000ff');
  });
});
