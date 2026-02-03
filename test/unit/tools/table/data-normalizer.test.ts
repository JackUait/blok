import { describe, it, expect } from 'vitest';
import { normalizeTableData, isLegacyTableData } from '../../../../src/tools/table/data-normalizer';

describe('Table data normalizer', () => {
  describe('isLegacyTableData', () => {
    it('detects legacy format (content as 2D array)', () => {
      expect(isLegacyTableData({
        withHeadings: true,
        content: [['A', 'B'], ['C', 'D']],
      })).toBe(true);
    });

    it('returns false for flat format (cells array)', () => {
      expect(isLegacyTableData({
        cells: ['A', 'B'],
      })).toBe(false);
    });
  });

  describe('normalizeTableData', () => {
    it('passes through modern format unchanged', () => {
      const data = { withHeadings: false, content: [['A']] };
      const result = normalizeTableData(data);

      expect(result.withHeadings).toBe(false);
      expect(result.content).toEqual([['A']]);
    });

    it('handles empty/missing data with defaults', () => {
      const result = normalizeTableData({});

      expect(result.withHeadings).toBe(false);
      expect(result.content).toEqual([]);
    });
  });
});
