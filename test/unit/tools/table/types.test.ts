import { describe, it, expect } from 'vitest';
import type { TableData, CellContent } from '../../../../src/tools/table/types';
import { isCellWithBlocks } from '../../../../src/tools/table/types';

describe('TableData types', () => {
  it('should accept string cell content for backwards compatibility', () => {
    const data: TableData = {
      withHeadings: false,
      content: [['Hello', 'World']],
    };

    expect(data.content[0][0]).toBe('Hello');
  });

  it('should accept block-based cell content', () => {
    const data: TableData = {
      withHeadings: false,
      content: [['Plain text', { blocks: ['block-1', 'block-2'] }]],
    };

    const cell = data.content[0][1];
    expect(isCellWithBlocks(cell)).toBe(true);

    if (isCellWithBlocks(cell)) {
      expect(cell.blocks).toEqual(['block-1', 'block-2']);
    }
  });

  describe('isCellWithBlocks', () => {
    it('should return true for block-based cell content', () => {
      const cell: CellContent = { blocks: ['block-1'] };
      expect(isCellWithBlocks(cell)).toBe(true);
    });

    it('should return false for string cell content', () => {
      const cell: CellContent = 'Plain text';
      expect(isCellWithBlocks(cell)).toBe(false);
    });

    it('should return false for empty string', () => {
      const cell: CellContent = '';
      expect(isCellWithBlocks(cell)).toBe(false);
    });
  });
});
