import { describe, it, expect } from 'vitest';
import type { TableCommand } from '../../../../src/tools/table/core/table-commands';
import type { TableDomainEvent } from '../../../../src/tools/table/core/table-events';

/**
 * Helper: recursively checks that no value in an object graph is an HTMLElement.
 */
function assertNoDOM(value: unknown, path = 'root'): void {
  if (value instanceof HTMLElement) {
    throw new Error(`Found HTMLElement at ${path}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoDOM(item, `${path}[${i}]`));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) {
      assertNoDOM(val, `${path}.${key}`);
    }
  }
}

describe('TableCommand contract', () => {
  describe('structural row commands', () => {
    it('models insert-row with index', () => {
      const cmd: TableCommand = { type: 'insert-row', index: 2 };

      expect(cmd.type).toBe('insert-row');
      if (cmd.type === 'insert-row') {
        expect(cmd.index).toBe(2);
      }
    });

    it('models delete-row with index', () => {
      const cmd: TableCommand = { type: 'delete-row', index: 0 };

      expect(cmd.type).toBe('delete-row');
      if (cmd.type === 'delete-row') {
        expect(cmd.index).toBe(0);
      }
    });

    it('models move-row with fromIndex and toIndex', () => {
      const cmd: TableCommand = { type: 'move-row', fromIndex: 1, toIndex: 3 };

      expect(cmd.type).toBe('move-row');
      if (cmd.type === 'move-row') {
        expect(cmd.fromIndex).toBe(1);
        expect(cmd.toIndex).toBe(3);
      }
    });
  });

  describe('structural column commands', () => {
    it('models insert-column with index', () => {
      const cmd: TableCommand = { type: 'insert-column', index: 1 };

      expect(cmd.type).toBe('insert-column');
      if (cmd.type === 'insert-column') {
        expect(cmd.index).toBe(1);
      }
    });

    it('models insert-column with optional width', () => {
      const cmd: TableCommand = { type: 'insert-column', index: 0, width: 150 };

      expect(cmd.type).toBe('insert-column');
      if (cmd.type === 'insert-column') {
        expect(cmd.index).toBe(0);
        expect(cmd.width).toBe(150);
      }
    });

    it('models delete-column with index', () => {
      const cmd: TableCommand = { type: 'delete-column', index: 2 };

      expect(cmd.type).toBe('delete-column');
      if (cmd.type === 'delete-column') {
        expect(cmd.index).toBe(2);
      }
    });

    it('models move-column with fromIndex and toIndex', () => {
      const cmd: TableCommand = { type: 'move-column', fromIndex: 0, toIndex: 4 };

      expect(cmd.type).toBe('move-column');
      if (cmd.type === 'move-column') {
        expect(cmd.fromIndex).toBe(0);
        expect(cmd.toIndex).toBe(4);
      }
    });
  });

  describe('metadata commands', () => {
    it('models toggle-heading', () => {
      const cmd: TableCommand = { type: 'toggle-heading' };

      expect(cmd.type).toBe('toggle-heading');
    });

    it('models toggle-heading-column', () => {
      const cmd: TableCommand = { type: 'toggle-heading-column' };

      expect(cmd.type).toBe('toggle-heading-column');
    });

    it('models set-stretched with boolean value', () => {
      const cmd: TableCommand = { type: 'set-stretched', value: true };

      expect(cmd.type).toBe('set-stretched');
      if (cmd.type === 'set-stretched') {
        expect(cmd.value).toBe(true);
      }
    });

    it('models set-stretched false', () => {
      const cmd: TableCommand = { type: 'set-stretched', value: false };

      if (cmd.type === 'set-stretched') {
        expect(cmd.value).toBe(false);
      }
    });
  });

  describe('cell commands', () => {
    it('models add-block-to-cell with row, col, blockId', () => {
      const cmd: TableCommand = { type: 'add-block-to-cell', row: 1, col: 2, blockId: 'blk-abc' };

      expect(cmd.type).toBe('add-block-to-cell');
      if (cmd.type === 'add-block-to-cell') {
        expect(cmd.row).toBe(1);
        expect(cmd.col).toBe(2);
        expect(cmd.blockId).toBe('blk-abc');
      }
    });

    it('models remove-block-from-cell with row, col, blockId', () => {
      const cmd: TableCommand = { type: 'remove-block-from-cell', row: 0, col: 0, blockId: 'blk-xyz' };

      expect(cmd.type).toBe('remove-block-from-cell');
      if (cmd.type === 'remove-block-from-cell') {
        expect(cmd.row).toBe(0);
        expect(cmd.col).toBe(0);
        expect(cmd.blockId).toBe('blk-xyz');
      }
    });

    it('models set-cell-blocks with row, col, blockIds', () => {
      const cmd: TableCommand = { type: 'set-cell-blocks', row: 3, col: 1, blockIds: ['a', 'b', 'c'] };

      expect(cmd.type).toBe('set-cell-blocks');
      if (cmd.type === 'set-cell-blocks') {
        expect(cmd.row).toBe(3);
        expect(cmd.col).toBe(1);
        expect(cmd.blockIds).toEqual(['a', 'b', 'c']);
      }
    });
  });

  describe('width commands', () => {
    it('models set-col-widths with array', () => {
      const cmd: TableCommand = { type: 'set-col-widths', widths: [100, 200, 150] };

      expect(cmd.type).toBe('set-col-widths');
      if (cmd.type === 'set-col-widths') {
        expect(cmd.widths).toEqual([100, 200, 150]);
      }
    });

    it('models set-col-widths with undefined (reset)', () => {
      const cmd: TableCommand = { type: 'set-col-widths', widths: undefined };

      if (cmd.type === 'set-col-widths') {
        expect(cmd.widths).toBeUndefined();
      }
    });
  });

  describe('lifecycle commands', () => {
    it('models replace-all with full TableData', () => {
      const cmd: TableCommand = {
        type: 'replace-all',
        data: {
          withHeadings: true,
          withHeadingColumn: false,
          content: [[{ blocks: ['b1'] }]],
        },
      };

      expect(cmd.type).toBe('replace-all');
      if (cmd.type === 'replace-all') {
        expect(cmd.data.withHeadings).toBe(true);
        expect(cmd.data.content).toHaveLength(1);
      }
    });
  });

  describe('discriminated union exhaustiveness', () => {
    it('covers all command types', () => {
      const allTypes: TableCommand['type'][] = [
        'insert-row',
        'delete-row',
        'move-row',
        'insert-column',
        'delete-column',
        'move-column',
        'toggle-heading',
        'toggle-heading-column',
        'set-stretched',
        'add-block-to-cell',
        'remove-block-from-cell',
        'set-cell-blocks',
        'set-col-widths',
        'replace-all',
      ];

      expect(allTypes).toHaveLength(14);
      expect(new Set(allTypes).size).toBe(14);
    });
  });
});

describe('TableDomainEvent contract', () => {
  describe('structural row events', () => {
    it('row-inserted contains index and cellsToPopulate count', () => {
      const event: TableDomainEvent = {
        type: 'row-inserted',
        index: 1,
        cellsToPopulate: 3,
      };

      expect(event.type).toBe('row-inserted');
      if (event.type === 'row-inserted') {
        expect(event.index).toBe(1);
        expect(event.cellsToPopulate).toBe(3);
      }
      assertNoDOM(event);
    });

    it('row-deleted contains index and block IDs to clean up', () => {
      const event: TableDomainEvent = {
        type: 'row-deleted',
        index: 2,
        blocksToDelete: ['blk-1', 'blk-2'],
      };

      expect(event.type).toBe('row-deleted');
      if (event.type === 'row-deleted') {
        expect(event.index).toBe(2);
        expect(event.blocksToDelete).toEqual(['blk-1', 'blk-2']);
      }
      assertNoDOM(event);
    });

    it('row-moved contains from and to indices', () => {
      const event: TableDomainEvent = {
        type: 'row-moved',
        fromIndex: 0,
        toIndex: 2,
      };

      expect(event.type).toBe('row-moved');
      if (event.type === 'row-moved') {
        expect(event.fromIndex).toBe(0);
        expect(event.toIndex).toBe(2);
      }
      assertNoDOM(event);
    });
  });

  describe('structural column events', () => {
    it('column-inserted contains index and cells to populate', () => {
      const event: TableDomainEvent = {
        type: 'column-inserted',
        index: 1,
        cellsToPopulate: [
          { row: 0, col: 1 },
          { row: 1, col: 1 },
        ],
      };

      expect(event.type).toBe('column-inserted');
      if (event.type === 'column-inserted') {
        expect(event.index).toBe(1);
        expect(event.cellsToPopulate).toHaveLength(2);
        expect(event.cellsToPopulate[0]).toEqual({ row: 0, col: 1 });
      }
      assertNoDOM(event);
    });

    it('column-deleted contains index and block IDs to clean up', () => {
      const event: TableDomainEvent = {
        type: 'column-deleted',
        index: 3,
        blocksToDelete: ['blk-a', 'blk-b', 'blk-c'],
      };

      expect(event.type).toBe('column-deleted');
      if (event.type === 'column-deleted') {
        expect(event.index).toBe(3);
        expect(event.blocksToDelete).toEqual(['blk-a', 'blk-b', 'blk-c']);
      }
      assertNoDOM(event);
    });

    it('column-moved contains from and to indices', () => {
      const event: TableDomainEvent = {
        type: 'column-moved',
        fromIndex: 4,
        toIndex: 0,
      };

      expect(event.type).toBe('column-moved');
      if (event.type === 'column-moved') {
        expect(event.fromIndex).toBe(4);
        expect(event.toIndex).toBe(0);
      }
      assertNoDOM(event);
    });
  });

  describe('metadata events', () => {
    it('heading-toggled contains resultant state', () => {
      const event: TableDomainEvent = {
        type: 'heading-toggled',
        withHeadings: true,
      };

      expect(event.type).toBe('heading-toggled');
      if (event.type === 'heading-toggled') {
        expect(event.withHeadings).toBe(true);
      }
      assertNoDOM(event);
    });

    it('heading-column-toggled contains resultant state', () => {
      const event: TableDomainEvent = {
        type: 'heading-column-toggled',
        withHeadingColumn: false,
      };

      expect(event.type).toBe('heading-column-toggled');
      if (event.type === 'heading-column-toggled') {
        expect(event.withHeadingColumn).toBe(false);
      }
      assertNoDOM(event);
    });

    it('stretched-changed contains resultant state', () => {
      const event: TableDomainEvent = {
        type: 'stretched-changed',
        stretched: true,
      };

      expect(event.type).toBe('stretched-changed');
      if (event.type === 'stretched-changed') {
        expect(event.stretched).toBe(true);
      }
      assertNoDOM(event);
    });
  });

  describe('cell events', () => {
    it('block-added-to-cell contains row, col, blockId', () => {
      const event: TableDomainEvent = {
        type: 'block-added-to-cell',
        row: 2,
        col: 1,
        blockId: 'blk-new',
      };

      expect(event.type).toBe('block-added-to-cell');
      if (event.type === 'block-added-to-cell') {
        expect(event.row).toBe(2);
        expect(event.col).toBe(1);
        expect(event.blockId).toBe('blk-new');
      }
      assertNoDOM(event);
    });

    it('block-removed-from-cell contains row, col, blockId', () => {
      const event: TableDomainEvent = {
        type: 'block-removed-from-cell',
        row: 0,
        col: 3,
        blockId: 'blk-gone',
      };

      expect(event.type).toBe('block-removed-from-cell');
      if (event.type === 'block-removed-from-cell') {
        expect(event.row).toBe(0);
        expect(event.col).toBe(3);
        expect(event.blockId).toBe('blk-gone');
      }
      assertNoDOM(event);
    });

    it('cell-blocks-set contains row, col, and full blockIds array', () => {
      const event: TableDomainEvent = {
        type: 'cell-blocks-set',
        row: 1,
        col: 1,
        blockIds: ['x', 'y'],
      };

      expect(event.type).toBe('cell-blocks-set');
      if (event.type === 'cell-blocks-set') {
        expect(event.row).toBe(1);
        expect(event.col).toBe(1);
        expect(event.blockIds).toEqual(['x', 'y']);
      }
      assertNoDOM(event);
    });
  });

  describe('width events', () => {
    it('col-widths-changed contains widths array', () => {
      const event: TableDomainEvent = {
        type: 'col-widths-changed',
        widths: [120, 180],
      };

      expect(event.type).toBe('col-widths-changed');
      if (event.type === 'col-widths-changed') {
        expect(event.widths).toEqual([120, 180]);
      }
      assertNoDOM(event);
    });

    it('col-widths-changed with undefined (reset to equal)', () => {
      const event: TableDomainEvent = {
        type: 'col-widths-changed',
        widths: undefined,
      };

      if (event.type === 'col-widths-changed') {
        expect(event.widths).toBeUndefined();
      }
      assertNoDOM(event);
    });
  });

  describe('lifecycle events', () => {
    it('model-replaced has no extra payload', () => {
      const event: TableDomainEvent = { type: 'model-replaced' };

      expect(event.type).toBe('model-replaced');
      assertNoDOM(event);
    });
  });

  describe('discriminated union exhaustiveness', () => {
    it('covers all event types', () => {
      const allTypes: TableDomainEvent['type'][] = [
        'row-inserted',
        'row-deleted',
        'row-moved',
        'column-inserted',
        'column-deleted',
        'column-moved',
        'heading-toggled',
        'heading-column-toggled',
        'stretched-changed',
        'block-added-to-cell',
        'block-removed-from-cell',
        'cell-blocks-set',
        'col-widths-changed',
        'model-replaced',
      ];

      expect(allTypes).toHaveLength(14);
      expect(new Set(allTypes).size).toBe(14);
    });
  });

  describe('no DOM references in any event', () => {
    it('rejects events containing HTMLElement values', () => {
      const badObj = {
        type: 'row-inserted' as const,
        index: 0,
        cellsToPopulate: 2,
        // Manually stuffing a DOM element to verify helper catches it
        sneakyDom: document.createElement('div'),
      };

      expect(() => assertNoDOM(badObj)).toThrow('Found HTMLElement');
    });
  });
});
