import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  wrapInNewColumnList,
  addColumnToList,
  type ColumnDropSide,
} from '../../../src/tools/column-drop';
import { COLUMN_LIST_TOOL, COLUMN_TOOL } from '../../../src/tools/columns-shared';
import type { API } from '../../../types';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

interface FakeBlockNode {
  id: string;
  parentId: string | null;
  index: number;
}

/**
 * Build a fake blocks API recording the calls the helpers issue. `nodes`
 * seeds getById/getBlockIndex; inserts hand back synthetic ids (prefixed by the
 * tool name) so the helpers can chain setBlockParent onto the created blocks.
 */
const createMockAPI = (nodes: FakeBlockNode[]) => {
  const byId = new Map(nodes.map(n => [n.id, n]));

  let insertCounter = 0;
  const insert = vi.fn().mockImplementation((type: string) => {
    insertCounter += 1;

    return { id: `${type}-new-${insertCounter}`, holder: document.createElement('div') };
  });

  const setBlockParent = vi.fn();
  const move = vi.fn();
  const transact = vi.fn().mockImplementation((fn: () => void) => fn());

  const getById = vi.fn().mockImplementation((id: string) => {
    const node = byId.get(id);

    return node ? { id: node.id, parentId: node.parentId } : null;
  });

  const getBlockIndex = vi.fn().mockImplementation((id: string) => byId.get(id)?.index);

  const api = {
    blocks: {
      insert,
      setBlockParent,
      move,
      transact,
      getById,
      getBlockIndex,
    },
  } as unknown as API;

  return { api, insert, setBlockParent, move, transact, getById, getBlockIndex };
};

describe('wrapInNewColumnList', () => {
  const side = (s: ColumnDropSide): ColumnDropSide => s;

  it('side right: inserts a column_list at the target index, creates 2 noSeed columns under it, target into first column, sources into second', () => {
    const mock = createMockAPI([
      { id: 'target', parentId: null, index: 4 },
      { id: 'src', parentId: null, index: 9 },
    ]);

    const result = wrapInNewColumnList(mock.api, 'target', ['src'], side('right'));

    // transact wraps the work and its fn actually runs
    expect(mock.transact).toHaveBeenCalledTimes(1);

    // 3 typed inserts: the list, then two columns (insertInsideParent only ever
    // creates the default paragraph, so columns must be typed inserts)
    expect(mock.insert).toHaveBeenCalledTimes(3);

    // column_list inserted at the target's flat index
    expect(mock.insert.mock.calls[0][0]).toBe(COLUMN_LIST_TOOL);
    expect(mock.insert.mock.calls[0][1]).toEqual({ noSeed: true });
    expect(mock.insert.mock.calls[0][3]).toBe(4);

    // two columns, typed + noSeed, just after the list
    expect(mock.insert.mock.calls[1][0]).toBe(COLUMN_TOOL);
    expect(mock.insert.mock.calls[1][1]).toEqual({ noSeed: true });
    expect(mock.insert.mock.calls[1][3]).toBe(5);
    expect(mock.insert.mock.calls[2][0]).toBe(COLUMN_TOOL);
    expect(mock.insert.mock.calls[2][3]).toBe(6);

    const listId = mock.insert.mock.results[0].value.id;
    const firstColumnId = mock.insert.mock.results[1].value.id;
    const secondColumnId = mock.insert.mock.results[2].value.id;

    // both columns reparented under the list
    expect(mock.setBlockParent).toHaveBeenCalledWith(firstColumnId, listId);
    expect(mock.setBlockParent).toHaveBeenCalledWith(secondColumnId, listId);

    // right: [target column, sources column] -> target into FIRST column
    expect(mock.setBlockParent).toHaveBeenCalledWith('target', firstColumnId);
    expect(mock.setBlockParent).toHaveBeenCalledWith('src', secondColumnId);

    expect(result).toBe(listId);
  });

  it('side left: reverses column order so the sources column is first', () => {
    const mock = createMockAPI([
      { id: 'target', parentId: null, index: 4 },
      { id: 'src', parentId: null, index: 9 },
    ]);

    wrapInNewColumnList(mock.api, 'target', ['src'], side('left'));

    const firstColumnId = mock.insert.mock.results[1].value.id;
    const secondColumnId = mock.insert.mock.results[2].value.id;

    // left: [sources column, target column] -> sources into FIRST column
    expect(mock.setBlockParent).toHaveBeenCalledWith('src', firstColumnId);
    expect(mock.setBlockParent).toHaveBeenCalledWith('target', secondColumnId);
  });

  it('multi-select: all sources reparent into the SAME sources column, in order', () => {
    const mock = createMockAPI([
      { id: 'target', parentId: null, index: 4 },
      { id: 's1', parentId: null, index: 9 },
      { id: 's2', parentId: null, index: 10 },
    ]);

    wrapInNewColumnList(mock.api, 'target', ['s1', 's2'], side('right'));

    // right: sources column is the SECOND column
    const sourcesColumnId = mock.insert.mock.results[2].value.id;

    const sourceReparents = mock.setBlockParent.mock.calls.filter(
      call => call[0] === 's1' || call[0] === 's2'
    );

    expect(sourceReparents).toEqual([
      ['s1', sourcesColumnId],
      ['s2', sourcesColumnId],
    ]);
  });

  it('self-drop (sources includes target) returns null with no mutation', () => {
    const mock = createMockAPI([
      { id: 'target', parentId: null, index: 4 },
    ]);

    const result = wrapInNewColumnList(mock.api, 'target', ['target'], side('right'));

    expect(result).toBeNull();
    expect(mock.insert).not.toHaveBeenCalled();
    expect(mock.transact).not.toHaveBeenCalled();
  });

  it('returns null when the target already has a parent', () => {
    const mock = createMockAPI([
      { id: 'target', parentId: 'some-col', index: 4 },
      { id: 'src', parentId: null, index: 9 },
    ]);

    const result = wrapInNewColumnList(mock.api, 'target', ['src'], side('right'));

    expect(result).toBeNull();
    expect(mock.insert).not.toHaveBeenCalled();
  });

  it('returns null when the target is stale (getBlockIndex undefined)', () => {
    const mock = createMockAPI([
      { id: 'src', parentId: null, index: 9 },
    ]);

    const result = wrapInNewColumnList(mock.api, 'target', ['src'], side('right'));

    expect(result).toBeNull();
    expect(mock.insert).not.toHaveBeenCalled();
  });

  it('returns null for empty sources', () => {
    const mock = createMockAPI([
      { id: 'target', parentId: null, index: 4 },
    ]);

    const result = wrapInNewColumnList(mock.api, 'target', [], side('right'));

    expect(result).toBeNull();
    expect(mock.insert).not.toHaveBeenCalled();
  });
});

describe('addColumnToList', () => {
  const side = (s: ColumnDropSide): ColumnDropSide => s;

  it('side right: inserts one typed noSeed column after the neighbor, reparents it under the list, and moves sources in order', () => {
    const mock = createMockAPI([
      { id: 'cl', parentId: null, index: 2 },
      { id: 'neighbor', parentId: 'cl', index: 3 },
      { id: 's1', parentId: null, index: 9 },
      { id: 's2', parentId: null, index: 10 },
    ]);

    const result = addColumnToList(mock.api, 'neighbor', ['s1', 's2'], side('right'));

    expect(mock.transact).toHaveBeenCalledTimes(1);

    // one typed column inserted, noSeed, after the neighbor's flat index
    expect(mock.insert).toHaveBeenCalledTimes(1);
    expect(mock.insert.mock.calls[0][0]).toBe(COLUMN_TOOL);
    expect(mock.insert.mock.calls[0][1]).toEqual({ noSeed: true });
    expect(mock.insert.mock.calls[0][3]).toBe(4); // neighborIndex + 1

    const newColumnId = mock.insert.mock.results[0].value.id;

    // reparented under the column_list
    expect(mock.setBlockParent).toHaveBeenCalledWith(newColumnId, 'cl');

    const reparents = mock.setBlockParent.mock.calls.filter(
      call => call[0] === 's1' || call[0] === 's2'
    );

    expect(reparents).toEqual([
      ['s1', newColumnId],
      ['s2', newColumnId],
    ]);

    expect(result).toBe(newColumnId);
  });

  it('side left: inserts the new column before the neighbor', () => {
    const mock = createMockAPI([
      { id: 'cl', parentId: null, index: 2 },
      { id: 'neighbor', parentId: 'cl', index: 5 },
      { id: 's1', parentId: null, index: 9 },
    ]);

    addColumnToList(mock.api, 'neighbor', ['s1'], side('left'));

    // left inserts AT the neighbor's index (before it)
    expect(mock.insert.mock.calls[0][3]).toBe(5);

    const rightMock = createMockAPI([
      { id: 'cl', parentId: null, index: 2 },
      { id: 'neighbor', parentId: 'cl', index: 5 },
      { id: 's1', parentId: null, index: 9 },
    ]);

    addColumnToList(rightMock.api, 'neighbor', ['s1'], side('right'));

    // right inserts after the neighbor, so its index is strictly greater
    const leftIndex = Number(mock.insert.mock.calls[0][3]);
    const rightIndex = Number(rightMock.insert.mock.calls[0][3]);
    expect(leftIndex).toBeLessThan(rightIndex);
  });

  it('returns null when the neighbor is stale (getBlockIndex undefined)', () => {
    const mock = createMockAPI([
      { id: 's1', parentId: null, index: 9 },
    ]);

    const result = addColumnToList(mock.api, 'neighbor', ['s1'], side('right'));

    expect(result).toBeNull();
    expect(mock.insert).not.toHaveBeenCalled();
  });

  it('returns null for empty sources', () => {
    const mock = createMockAPI([
      { id: 'cl', parentId: null, index: 2 },
      { id: 'neighbor', parentId: 'cl', index: 3 },
    ]);

    const result = addColumnToList(mock.api, 'neighbor', [], side('right'));

    expect(result).toBeNull();
    expect(mock.insert).not.toHaveBeenCalled();
  });
});
