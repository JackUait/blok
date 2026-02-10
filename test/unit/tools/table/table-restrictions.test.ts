import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isInsideTableCell } from '../../../../src/tools/table/table-restrictions';
import type { Block } from '../../../../src/components/block';

describe('table-restrictions', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  describe('isInsideTableCell', () => {
    it('returns true when block is inside table cell', () => {
      const cellBlocks = document.createElement('div');
      cellBlocks.setAttribute('data-blok-table-cell-blocks', '');

      const holder = document.createElement('div');
      cellBlocks.appendChild(holder);
      container.appendChild(cellBlocks);

      const block = { holder } as Block;

      expect(isInsideTableCell(block)).toBe(true);
    });

    it('returns false when block is outside table cell', () => {
      const holder = document.createElement('div');
      container.appendChild(holder);

      const block = { holder } as Block;

      expect(isInsideTableCell(block)).toBe(false);
    });

    it('returns false when block is null', () => {
      expect(isInsideTableCell(null)).toBe(false);
    });

    it('returns false when block is undefined', () => {
      expect(isInsideTableCell(undefined)).toBe(false);
    });

    it('works with HTMLElement directly', () => {
      const cellBlocks = document.createElement('div');
      cellBlocks.setAttribute('data-blok-table-cell-blocks', '');

      const element = document.createElement('div');
      cellBlocks.appendChild(element);
      container.appendChild(cellBlocks);

      expect(isInsideTableCell(element)).toBe(true);
    });
  });
});
