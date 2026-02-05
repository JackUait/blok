import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TableKeyboard } from '../../../../src/tools/table/table-keyboard';
import { TableGrid } from '../../../../src/tools/table/table-core';

describe('TableKeyboard', () => {
  let grid: TableGrid;
  let gridElement: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    grid = new TableGrid({ readOnly: false });
    gridElement = grid.createGrid(3, 3);
    grid.fillGrid(gridElement, [
      ['A', 'B', 'C'],
      ['D', 'E', 'F'],
      ['G', 'H', 'I'],
    ]);
    document.body.appendChild(gridElement);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.removeChild(gridElement);
  });

  describe('Tab key', () => {
    it('moves focus to next cell', () => {
      const keyboard = new TableKeyboard(grid, gridElement);

      // Next cell should be (0, 1)
      expect(keyboard.getTargetCell(0, 0, 'Tab')).toEqual({ row: 0, col: 1 });
    });

    it('wraps to next row when at end of row', () => {
      const keyboard = new TableKeyboard(grid, gridElement);

      expect(keyboard.getTargetCell(0, 2, 'Tab')).toEqual({ row: 1, col: 0 });
    });

    it('returns null when at last cell', () => {
      const keyboard = new TableKeyboard(grid, gridElement);

      expect(keyboard.getTargetCell(2, 2, 'Tab')).toBeNull();
    });
  });

  describe('Enter key', () => {
    it('moves focus to cell below', () => {
      const keyboard = new TableKeyboard(grid, gridElement);

      expect(keyboard.getTargetCell(0, 1, 'Enter')).toEqual({ row: 1, col: 1 });
    });

    it('returns null with addRow flag when at last row', () => {
      const keyboard = new TableKeyboard(grid, gridElement);

      expect(keyboard.getTargetCell(2, 1, 'Enter')).toEqual({ row: 3, col: 1, addRow: true });
    });
  });

  describe('handleKeyDown', () => {
    it('prevents default for Tab key and attempts to focus next cell', () => {
      const keyboard = new TableKeyboard(grid, gridElement);
      const nextCell = grid.getCell(gridElement, 0, 1);

      expect(nextCell).not.toBeNull();

      const focusSpy = vi.spyOn(nextCell as HTMLElement, 'focus');

      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });

      keyboard.handleKeyDown(event, { row: 0, col: 0 });

      expect(event.defaultPrevented).toBe(true);
      expect(focusSpy).toHaveBeenCalled();
    });

    it('adds new row when Enter is pressed at last row', () => {
      const keyboard = new TableKeyboard(grid, gridElement);
      const addRowSpy = vi.spyOn(grid, 'addRow');

      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });

      keyboard.handleKeyDown(event, { row: 2, col: 1 });

      expect(addRowSpy).toHaveBeenCalledWith(gridElement);
    });
  });
});
