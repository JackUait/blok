import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isInsideTableCell, isRestrictedInTableCell } from '../../../../src/tools/table/table-restrictions';
import type { Block } from '../../../../src/components/block';

describe('table-restrictions', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
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

  describe('isRestrictedInTableCell', () => {
    it('returns true for header tool', () => {
      expect(isRestrictedInTableCell('header')).toBe(true);
    });

    it('returns true for table tool', () => {
      expect(isRestrictedInTableCell('table')).toBe(true);
    });

    it('returns false for paragraph tool', () => {
      expect(isRestrictedInTableCell('paragraph')).toBe(false);
    });

    it('returns false for list tool', () => {
      expect(isRestrictedInTableCell('list')).toBe(false);
    });

    it('returns false for unknown tool', () => {
      expect(isRestrictedInTableCell('unknown-tool')).toBe(false);
    });
  });
});
