import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TableEventBroker } from '../../../../src/tools/table/ownership/table-event-broker';
import { TableOwnershipRegistry } from '../../../../src/tools/table/ownership/table-ownership-registry';
import { TableModel } from '../../../../src/tools/table/table-model';
import type { CellContent, TableData } from '../../../../src/tools/table/types';

/**
 * These tests prove the ownership broker can completely replace the
 * adjacency heuristics in TableCellBlocks.
 *
 * Each test models a scenario that currently requires `isAdjacentToThisTable`,
 * `findCellForNewBlock`, or `removedBlockCells` cross-table keying,
 * and demonstrates that broker routing handles it deterministically.
 */

// ─── Helpers ───────────────────────────────────────────────────────

const cell = (...blocks: string[]): CellContent => ({ blocks });

const makeData = (overrides: Partial<TableData> = {}): TableData => ({
  withHeadings: false,
  withHeadingColumn: false,
  content: [],
  ...overrides,
});

// ─── Tests ─────────────────────────────────────────────────────────

describe('Broker replaces heuristic routing', () => {
  let registry: TableOwnershipRegistry;
  let broker: TableEventBroker;

  beforeEach(() => {
    registry = new TableOwnershipRegistry();
    broker = new TableEventBroker(registry);
  });

  describe('cross-table adjacency scenarios (replaces isAdjacentToThisTable)', () => {
    it('routes block-added to correct table when blocks are adjacent in flat list', () => {
      // Scenario: Two tables back-to-back. Block at flat index N belongs to
      // table-A, block at N+1 belongs to table-B. A new block at N+1 should
      // go to table-B, not table-A.
      //
      // Previously required isAdjacentToThisTable to disambiguate.
      const handlerA = vi.fn();
      const handlerB = vi.fn();

      broker.subscribe('table-A', handlerA);
      broker.subscribe('table-B', handlerB);

      // Table A owns blocks at the "end" of its range
      registry.setOwner('a-last', { tableId: 'table-A', row: 1, col: 1 });
      // Table B owns blocks at the "start" of its range
      registry.setOwner('b-first', { tableId: 'table-B', row: 0, col: 0 });

      // New block for table-B arrives (registered before event)
      registry.setOwner('b-new', { tableId: 'table-B', row: 0, col: 0 });
      broker.routeBlockEvent('b-new', { type: 'block-added' });

      expect(handlerB).toHaveBeenCalledTimes(1);
      expect(handlerA).not.toHaveBeenCalled();
    });

    it('routes block events correctly with interleaved table blocks', () => {
      // Scenario: In a complex layout, table blocks are interleaved
      // (not contiguous in flat list).
      const handlerA = vi.fn();
      const handlerB = vi.fn();

      broker.subscribe('table-A', handlerA);
      broker.subscribe('table-B', handlerB);

      // Interleaved ownership
      registry.setOwner('b1', { tableId: 'table-A', row: 0, col: 0 });
      registry.setOwner('b2', { tableId: 'table-B', row: 0, col: 0 });
      registry.setOwner('b3', { tableId: 'table-A', row: 0, col: 1 });
      registry.setOwner('b4', { tableId: 'table-B', row: 0, col: 1 });

      broker.routeBlockEvent('b1', { type: 'block-changed' });
      broker.routeBlockEvent('b2', { type: 'block-changed' });
      broker.routeBlockEvent('b3', { type: 'block-changed' });
      broker.routeBlockEvent('b4', { type: 'block-changed' });

      expect(handlerA).toHaveBeenCalledTimes(2);
      expect(handlerB).toHaveBeenCalledTimes(2);
    });
  });

  describe('replace operations (replaces removedBlockCells cross-table keying)', () => {
    it('routes replacement block to same table as the removed block', () => {
      // Scenario: Block "old" is removed from table-A cell [0,0].
      // A new block "new" appears at the same position (replace op).
      // With heuristics, removedBlockCells map was needed to link them.
      // With broker, ownership is pre-registered before the event.
      const handlerA = vi.fn();

      broker.subscribe('table-A', handlerA);

      // Old block owned by table-A
      registry.setOwner('old-block', { tableId: 'table-A', row: 0, col: 0 });

      // Remove event
      broker.routeBlockEvent('old-block', { type: 'block-removed' });
      registry.removeOwner('old-block');

      // New block arrives — ownership set before event
      registry.setOwner('new-block', { tableId: 'table-A', row: 0, col: 0 });
      broker.routeBlockEvent('new-block', { type: 'block-added' });

      expect(handlerA).toHaveBeenCalledTimes(2);
      expect(handlerA).toHaveBeenCalledWith('old-block', { type: 'block-removed' });
      expect(handlerA).toHaveBeenCalledWith('new-block', { type: 'block-added' });
    });

    it('does not cross-claim replacement blocks between tables', () => {
      // Scenario: Table-A removes a block at flat index N.
      // Table-B simultaneously adds a block at index N.
      // Without broker, removedBlockCells could cause cross-table claim.
      const handlerA = vi.fn();
      const handlerB = vi.fn();

      broker.subscribe('table-A', handlerA);
      broker.subscribe('table-B', handlerB);

      registry.setOwner('a-old', { tableId: 'table-A', row: 0, col: 0 });

      // Remove from table-A
      broker.routeBlockEvent('a-old', { type: 'block-removed' });
      registry.removeOwner('a-old');

      // New block — but for table-B, not table-A
      registry.setOwner('b-new', { tableId: 'table-B', row: 0, col: 0 });
      broker.routeBlockEvent('b-new', { type: 'block-added' });

      expect(handlerA).toHaveBeenCalledTimes(1); // Only the remove
      expect(handlerB).toHaveBeenCalledTimes(1); // Only the add
      expect(handlerA).toHaveBeenCalledWith('a-old', { type: 'block-removed' });
      expect(handlerB).toHaveBeenCalledWith('b-new', { type: 'block-added' });
    });
  });

  describe('structural operation scenarios (replaces structuralOpDepth deferral)', () => {
    it('does not route events for blocks with no owner during structural ops', () => {
      // During a structural op, blocks may be temporarily without ownership.
      // The broker simply drops these events — no heuristic claim.
      const handler = vi.fn();

      broker.subscribe('table-A', handler);

      // Block appears during structural op, not yet registered
      broker.routeBlockEvent('unregistered-block', { type: 'block-added' });

      expect(handler).not.toHaveBeenCalled();
    });

    it('routes events correctly after ownership reconciliation post-structural-op', () => {
      // After a structural op (e.g., add column), the model is updated
      // and ownership is reconciled. Subsequent events route correctly.
      const handler = vi.fn();

      broker.subscribe('table-A', handler);

      const model = new TableModel(makeData({
        content: [
          [cell('b1'), cell('b2')],
        ],
      }));

      // Reconcile after structural op
      registry.reconcileWithModel('table-A', model);

      // Events now route correctly
      broker.routeBlockEvent('b1', { type: 'block-changed' });
      broker.routeBlockEvent('b2', { type: 'block-changed' });

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('model operations update ownership so broker routes correctly', () => {
      const handler = vi.fn();

      broker.subscribe('table-A', handler);

      const model = new TableModel(makeData({
        content: [[cell('b1'), cell('b2')]],
      }));

      registry.reconcileWithModel('table-A', model);

      // Add a row and new blocks
      model.addRow(1);
      model.addBlockToCell(1, 0, 'b3');
      model.addBlockToCell(1, 1, 'b4');

      // Re-reconcile
      registry.reconcileWithModel('table-A', model);

      // All four blocks should route correctly
      broker.routeBlockEvent('b1', { type: 'block-changed' });
      broker.routeBlockEvent('b3', { type: 'block-changed' });

      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('multi-table operations do not cross-claim blocks', () => {
    it('simultaneous operations on two tables keep ownership correct', () => {
      const handlerA = vi.fn();
      const handlerB = vi.fn();

      broker.subscribe('table-A', handlerA);
      broker.subscribe('table-B', handlerB);

      const modelA = new TableModel(makeData({
        content: [[cell('a1'), cell('a2')]],
      }));
      const modelB = new TableModel(makeData({
        content: [[cell('b1'), cell('b2')]],
      }));

      registry.reconcileWithModel('table-A', modelA);
      registry.reconcileWithModel('table-B', modelB);

      // Both tables add columns simultaneously
      modelA.addColumn();
      modelA.addBlockToCell(0, 2, 'a3');
      registry.reconcileWithModel('table-A', modelA);

      modelB.addColumn();
      modelB.addBlockToCell(0, 2, 'b3');
      registry.reconcileWithModel('table-B', modelB);

      // Events route correctly
      broker.routeBlockEvent('a3', { type: 'block-added' });
      broker.routeBlockEvent('b3', { type: 'block-added' });

      expect(handlerA).toHaveBeenCalledWith('a3', { type: 'block-added' });
      expect(handlerB).toHaveBeenCalledWith('b3', { type: 'block-added' });
      expect(handlerA).toHaveBeenCalledTimes(1);
      expect(handlerB).toHaveBeenCalledTimes(1);
    });
  });

  describe('does not depend on adjacency heuristics after broker cutover', () => {
    it('event routing uses ownership only — no flat-list index needed', () => {
      const handler = vi.fn();

      broker.subscribe('table-A', handler);

      // Register ownership without any knowledge of flat-list indices
      registry.setOwner('block-x', { tableId: 'table-A', row: 2, col: 3 });

      broker.routeBlockEvent('block-x', { type: 'block-changed' });

      expect(handler).toHaveBeenCalledTimes(1);
      // No index/position argument needed — ownership is the routing key
      expect(handler).toHaveBeenCalledWith('block-x', { type: 'block-changed' });
    });

    it('non-table blocks are silently ignored', () => {
      const handler = vi.fn();

      broker.subscribe('table-A', handler);

      // A regular paragraph block that's not in any table
      broker.routeBlockEvent('standalone-paragraph', { type: 'block-changed' });

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
