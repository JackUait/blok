import { describe, it, expect } from 'vitest';
import { normalizeTableData } from '../../../../src/tools/table/table-operations';
import type { TableData } from '../../../../src/tools/table/types';

/**
 * Regression for M2: colWidths were accepted on length match alone, with no
 * numeric validation. NaN / negative / non-finite widths passed through,
 * round-tripped on save, and produced an invalid "NaNpx" grid width (silent
 * width loss). Reject the whole array unless every entry is finite and > 0.
 */
describe('normalizeTableData colWidths numeric validation', () => {
  const dataWith = (colWidths: number[]): TableData => ({
    withHeadings: false,
    withHeadingColumn: false,
    content: [
      [{ blocks: [] }, { blocks: [] }],
    ],
    colWidths,
  });

  it('drops colWidths containing NaN', () => {
    const result = normalizeTableData(dataWith([NaN, 200]), {});

    expect(result.colWidths).toBeUndefined();
  });

  it('drops colWidths containing a negative width', () => {
    const result = normalizeTableData(dataWith([-50, 200]), {});

    expect(result.colWidths).toBeUndefined();
  });

  it('drops colWidths containing zero', () => {
    const result = normalizeTableData(dataWith([0, 200]), {});

    expect(result.colWidths).toBeUndefined();
  });

  it('drops colWidths containing Infinity', () => {
    const result = normalizeTableData(dataWith([Infinity, 200]), {});

    expect(result.colWidths).toBeUndefined();
  });

  it('keeps valid positive finite colWidths', () => {
    const result = normalizeTableData(dataWith([100, 200]), {});

    expect(result.colWidths).toEqual([100, 200]);
  });
});
