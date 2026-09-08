import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TableOwnershipRegistry } from '../../../../src/tools/table/ownership/table-ownership-registry';
import { TableModel } from '../../../../src/tools/table/table-model';
import type { CellContent, TableData } from '../../../../src/tools/table/types';

/**
 * Mutation-coverage tests for
 * `src/tools/table/ownership/table-ownership-registry.ts`.
 *
 * Equivalence proof for the one mutant left alive:
 *
 * - L56 `owner !== null` replaced by `true`, in
 *   `return owner !== null && owner !== undefined && owner.tableId === tableId`.
 *   `owner` is `this.owners.get(blockId)`, and a Map answers a miss with
 *   `undefined`, never `null` - the following conjunct is the one that catches
 *   a miss. The only writers are `setOwner` and `reconcileWithModel`, both of
 *   which store a `BlockOwnership` object, so no reachable state puts `null`
 *   in the map. The operand cannot change the answer for any input the typed
 *   API accepts.
 */

const cell = (...blocks: string[]): CellContent => ({ blocks });

const makeData = (overrides: Partial<TableData> = {}): TableData => ({
  withHeadings: false,
  withHeadingColumn: false,
  content: [],
  ...overrides,
});

/**
 * Block ids are opaque strings handed to the registry by core; nothing about
 * their shape may decide whether an entry survives a reconcile.
 */
const OPAQUE_IDS = ['other-block', 'block with spaces', 'Stryker was here', '0'];

let registry: TableOwnershipRegistry;

beforeEach(() => {
  vi.clearAllMocks();
  registry = new TableOwnershipRegistry();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TableOwnershipRegistry mutants - reconcileWithModel', () => {
  it.each(OPAQUE_IDS)('leaves %j owned by another table untouched', (id) => {
    registry.setOwner(id, { tableId: 'table-B', row: 3, col: 4 });

    registry.reconcileWithModel('table-A', new TableModel(makeData({ content: [[cell('b1')]] })));

    expect(registry.getOwner(id)).toEqual({ tableId: 'table-B', row: 3, col: 4 });
    expect(registry.getOwner('b1')).toEqual({ tableId: 'table-A', row: 0, col: 0 });
  });

  it('drops the reconciled table stale entries and re-seeds from the model', () => {
    registry.setOwner('stale', { tableId: 'table-A', row: 9, col: 9 });
    registry.setOwner('b1', { tableId: 'table-A', row: 9, col: 9 });

    registry.reconcileWithModel('table-A', new TableModel(makeData({
      content: [[cell('b1'), cell('b2')]],
    })));

    expect(registry.getOwner('stale')).toBeNull();
    expect(registry.getBlocksForTable('table-A')).toEqual(['b1', 'b2']);
  });
});

describe('TableOwnershipRegistry mutants - removeTable', () => {
  it.each(OPAQUE_IDS)('keeps %j when a different table is removed', (id) => {
    registry.setOwner(id, { tableId: 'table-B', row: 1, col: 2 });
    registry.setOwner('gone', { tableId: 'table-A', row: 0, col: 0 });

    registry.removeTable('table-A');

    expect(registry.getOwner(id)).toEqual({ tableId: 'table-B', row: 1, col: 2 });
    expect(registry.getOwner('gone')).toBeNull();
  });

  it('removes every block of the table it was given', () => {
    registry.setOwner('a', { tableId: 'table-A', row: 0, col: 0 });
    registry.setOwner('b', { tableId: 'table-A', row: 0, col: 1 });

    registry.removeTable('table-A');

    expect(registry.getBlocksForTable('table-A')).toEqual([]);
  });
});

describe('TableOwnershipRegistry mutants - isOwnedByTable', () => {
  it('answers false for a block nobody tracks', () => {
    expect(registry.isOwnedByTable('unknown', 'table-A')).toBe(false);
  });

  it('answers false for a block owned by another table', () => {
    registry.setOwner('b1', { tableId: 'table-B', row: 0, col: 0 });

    expect(registry.isOwnedByTable('b1', 'table-A')).toBe(false);
  });

  it('answers true only for the owning table', () => {
    registry.setOwner('b1', { tableId: 'table-A', row: 0, col: 0 });

    expect(registry.isOwnedByTable('b1', 'table-A')).toBe(true);
  });

  it('answers false again once the block is removed', () => {
    registry.setOwner('b1', { tableId: 'table-A', row: 0, col: 0 });
    registry.removeOwner('b1');

    expect(registry.isOwnedByTable('b1', 'table-A')).toBe(false);
    expect(registry.getOwner('b1')).toBeNull();
  });
});
