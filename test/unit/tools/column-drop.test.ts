import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  wrapInNewColumnList,
  addColumnToList,
  wrapBlocksInColumns,
  type ColumnDropSide,
} from '../../../src/tools/column-drop';
import { COLUMN_LIST_TOOL, COLUMN_TOOL } from '../../../src/tools/columns-shared';
import {
  animateColumnWidths,
  captureSiblingTops,
  playSiblingShift,
} from '../../../src/components/modules/drag/utils/ColumnDropAnimation';
import type { API } from '../../../types';

vi.mock('../../../src/components/modules/drag/utils/ColumnDropAnimation', () => ({
  animateColumnWidths: vi.fn(),
  captureSiblingTops: vi.fn().mockReturnValue([]),
  playSiblingShift: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

interface FakeBlockNode {
  id: string;
  parentId: string | null;
  index: number;
  holder?: HTMLElement;
}

interface CreatedBlock {
  type: string;
  data: unknown;
  id: string;
  holder: HTMLElement;
  /** Where insertAt was asked to put it; undefined for an index insert. */
  placement?: { parentId?: string | null; position?: unknown };
}

/**
 * Build a fake blocks API recording the calls the helpers issue. `nodes`
 * seeds getById/getBlockIndex; inserts hand back synthetic ids (prefixed by the
 * tool name) so the helpers can chain setBlockParent onto the created blocks.
 * `created` lists every block made, by either insert method, in order.
 */
const createMockAPI = (nodes: FakeBlockNode[]) => {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const created: CreatedBlock[] = [];

  const create = (type: string, data: unknown, placement?: CreatedBlock['placement']): CreatedBlock => {
    const block = { type, data, id: `${type}-new-${created.length + 1}`, holder: document.createElement('div'), placement };

    created.push(block);

    return block;
  };
  const insert = vi.fn().mockImplementation((type: string, data: unknown) => create(type, data));
  const insertAt = vi.fn().mockImplementation((type: string, data: unknown, options: { parentId?: string | null; position?: unknown }) =>
    create(type, data, { parentId: options.parentId, position: options.position })
  );

  const setBlockParent = vi.fn();
  const move = vi.fn();
  const transact = vi.fn().mockImplementation((fn: () => void) => fn());

  const getById = vi.fn().mockImplementation((id: string) => {
    const node = byId.get(id);

    return node ? { id: node.id, parentId: node.parentId, holder: node.holder } : null;
  });

  const getBlockIndex = vi.fn().mockImplementation((id: string) => byId.get(id)?.index);
  const getBlocksCount = vi.fn().mockImplementation(() => Math.max(0, ...nodes.map(n => n.index + 1)));
  const getBlockByIndex = vi.fn().mockImplementation((index: number) => {
    const node = nodes.find(n => n.index === index);

    return node ? { id: node.id, parentId: node.parentId } : undefined;
  });

  const childrenByParent = new Map<string, Array<{ id: string; holder: HTMLElement }>>();
  const getChildren = vi.fn().mockImplementation(
    (parentId: string) => childrenByParent.get(parentId) ?? []
  );

  const api = {
    blocks: {
      insert,
      insertAt,
      setBlockParent,
      move,
      transact,
      getById,
      getBlockIndex,
      getBlocksCount,
      getBlockByIndex,
      getChildren,
    },
  } as unknown as API;

  return { api, created, setBlockParent, move, transact, getById, getBlockIndex, getChildren, childrenByParent };
};

describe('wrapInNewColumnList', () => {
  const side = (s: ColumnDropSide): ColumnDropSide => s;

  it('side right: puts a column_list where the target was, with 2 noSeed columns, target into the first column, sources into the second', () => {
    const mock = createMockAPI([
      { id: 'target', parentId: null, index: 4 },
      { id: 'src', parentId: null, index: 9 },
    ]);

    const result = wrapInNewColumnList(mock.api, 'target', ['src'], side('right'));

    // transact wraps the work and its fn actually runs
    expect(mock.transact).toHaveBeenCalledTimes(1);

    const [list, firstColumn, secondColumn] = mock.created;
    const listId = list.id;
    const firstColumnId = firstColumn.id;
    const secondColumnId = secondColumn.id;

    // The list takes the target's place at the root; two noSeed columns go under it, in order.
    expect(mock.created.map(({ type, data, placement }) => ({ type, data, placement }))).toEqual([
      { type: COLUMN_LIST_TOOL, data: { noSeed: true }, placement: { parentId: null, position: { before: 'target' } } },
      { type: COLUMN_TOOL, data: { noSeed: true }, placement: { parentId: listId, position: 'end' } },
      { type: COLUMN_TOOL, data: { noSeed: true }, placement: { parentId: listId, position: 'end' } },
    ]);

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

    const firstColumnId = mock.created[1].id;
    const secondColumnId = mock.created[2].id;

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
    const sourcesColumnId = mock.created[2].id;

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
    expect(mock.created).toEqual([]);
    expect(mock.transact).not.toHaveBeenCalled();
  });

  it('returns null when the target already has a parent', () => {
    const mock = createMockAPI([
      { id: 'target', parentId: 'some-col', index: 4 },
      { id: 'src', parentId: null, index: 9 },
    ]);

    const result = wrapInNewColumnList(mock.api, 'target', ['src'], side('right'));

    expect(result).toBeNull();
    expect(mock.created).toEqual([]);
  });

  it('returns null when the target is stale (getBlockIndex undefined)', () => {
    const mock = createMockAPI([
      { id: 'src', parentId: null, index: 9 },
    ]);

    const result = wrapInNewColumnList(mock.api, 'target', ['src'], side('right'));

    expect(result).toBeNull();
    expect(mock.created).toEqual([]);
  });

  it('returns null for empty sources', () => {
    const mock = createMockAPI([
      { id: 'target', parentId: null, index: 4 },
    ]);

    const result = wrapInNewColumnList(mock.api, 'target', [], side('right'));

    expect(result).toBeNull();
    expect(mock.created).toEqual([]);
  });
});

describe('addColumnToList', () => {
  const side = (s: ColumnDropSide): ColumnDropSide => s;

  it('side right: adds one noSeed column to the list after the neighbor and moves sources into it in order', () => {
    const mock = createMockAPI([
      { id: 'cl', parentId: null, index: 2 },
      { id: 'neighbor', parentId: 'cl', index: 3 },
      { id: 's1', parentId: null, index: 9 },
      { id: 's2', parentId: null, index: 10 },
    ]);

    const result = addColumnToList(mock.api, 'neighbor', ['s1', 's2'], side('right'));

    expect(mock.transact).toHaveBeenCalledTimes(1);

    // one noSeed column, in the list right after the neighbor
    expect(mock.created.map(({ type, data, placement }) => ({ type, data, placement }))).toEqual([
      { type: COLUMN_TOOL, data: { noSeed: true }, placement: { parentId: 'cl', position: { after: 'neighbor' } } },
    ]);

    const newColumnId = mock.created[0].id;

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

    expect(mock.created[0].placement).toEqual({ parentId: 'cl', position: { before: 'neighbor' } });
  });

  it('re-splits the row evenly: every column holder flex-grow reset to 1 after a column is added', () => {
    const mock = createMockAPI([
      { id: 'cl', parentId: null, index: 2 },
      { id: 'neighbor', parentId: 'cl', index: 3 },
      { id: 's1', parentId: null, index: 9 },
    ]);

    // Existing columns carry uneven custom widths from a prior resize.
    const makeColumn = (id: string, grow: string) => {
      const holder = document.createElement('div');

      holder.style.flexGrow = grow;

      return { id, holder };
    };
    const existingA = makeColumn('neighbor', '2');
    const existingB = makeColumn('colB', '0.5');
    const newColumn = makeColumn('column-new-1', '1');

    mock.childrenByParent.set('cl', [existingA, existingB, newColumn]);

    addColumnToList(mock.api, 'neighbor', ['s1'], side('right'));

    expect(mock.getChildren).toHaveBeenCalledWith('cl');
    expect([existingA, existingB, newColumn].map(c => c.holder.style.flexGrow))
      .toEqual(['1', '1', '1']);
  });

  it('returns null when the neighbor is stale (getBlockIndex undefined)', () => {
    const mock = createMockAPI([
      { id: 's1', parentId: null, index: 9 },
    ]);

    const result = addColumnToList(mock.api, 'neighbor', ['s1'], side('right'));

    expect(result).toBeNull();
    expect(mock.created).toEqual([]);
  });

  it('returns null for empty sources', () => {
    const mock = createMockAPI([
      { id: 'cl', parentId: null, index: 2 },
      { id: 'neighbor', parentId: 'cl', index: 3 },
    ]);

    const result = addColumnToList(mock.api, 'neighbor', [], side('right'));

    expect(result).toBeNull();
    expect(mock.created).toEqual([]);
  });
});

describe('wrapBlocksInColumns', () => {
  it('creates one column per selected block under a new column_list, in order', () => {
    const mock = createMockAPI([
      { id: 'a', parentId: null, index: 2 },
      { id: 'b', parentId: null, index: 3 },
      { id: 'c', parentId: null, index: 4 },
    ]);

    const result = wrapBlocksInColumns(mock.api, ['a', 'b', 'c']);

    expect(mock.transact).toHaveBeenCalledTimes(1);
    // the list takes the first block's place, then one column per block, in order
    expect(mock.created.map(({ type, placement }) => ({ type, placement }))).toEqual([
      { type: COLUMN_LIST_TOOL, placement: { parentId: null, position: { before: 'a' } } },
      { type: COLUMN_TOOL, placement: { parentId: 'column_list-new-1', position: 'end' } },
      { type: COLUMN_TOOL, placement: { parentId: 'column_list-new-1', position: 'end' } },
      { type: COLUMN_TOOL, placement: { parentId: 'column_list-new-1', position: 'end' } },
    ]);

    // each block reparented into its own created column, in selection order
    expect(mock.setBlockParent).toHaveBeenCalledWith('a', 'column-new-2');
    expect(mock.setBlockParent).toHaveBeenCalledWith('b', 'column-new-3');
    expect(mock.setBlockParent).toHaveBeenCalledWith('c', 'column-new-4');

    expect(result).toBe('column_list-new-1');
  });

  it('aborts (returns null, no mutation) for fewer than 2 blocks', () => {
    const mock = createMockAPI([{ id: 'a', parentId: null, index: 0 }]);

    expect(wrapBlocksInColumns(mock.api, ['a'])).toBeNull();
    expect(mock.created).toEqual([]);
  });

  it('aborts when fewer than 2 top-level blocks remain after ignoring nested ones', () => {
    const mock = createMockAPI([
      { id: 'a', parentId: null, index: 0 },
      { id: 'b', parentId: 'some-col', index: 1 },
    ]);

    expect(wrapBlocksInColumns(mock.api, ['a', 'b'])).toBeNull();
    expect(mock.created).toEqual([]);
  });

  it('aborts when any block id is stale', () => {
    const mock = createMockAPI([{ id: 'a', parentId: null, index: 0 }]);

    expect(wrapBlocksInColumns(mock.api, ['a', 'ghost'])).toBeNull();
    expect(mock.created).toEqual([]);
  });

  it('wraps a selected column_list as one nested column, ignoring its descendant columns present in the selection', () => {
    // A cross-block selection spanning a column_list also marks its nested
    // columns selected (the selection walks the flat block array). Only the
    // TOP-LEVEL blocks should each become a column; the column_list rides into
    // a single column with its sub-tree intact.
    const mock = createMockAPI([
      { id: 'cl', parentId: null, index: 2 },
      { id: 'colA', parentId: 'cl', index: 3 },
      { id: 'colB', parentId: 'cl', index: 4 },
      { id: 'p', parentId: null, index: 5 },
    ]);

    const result = wrapBlocksInColumns(mock.api, ['cl', 'colA', 'colB', 'p']);

    expect(result).toBe('column_list-new-1');
    // 1 new list at the column_list's place + 2 columns (one per top-level block), NOT one per selected id
    expect(mock.created.map(({ type }) => type)).toEqual([COLUMN_LIST_TOOL, COLUMN_TOOL, COLUMN_TOOL]);
    expect(mock.created[0].placement).toEqual({ parentId: null, position: { before: 'cl' } });

    // column_list nests as a single column; the paragraph gets its own
    expect(mock.setBlockParent).toHaveBeenCalledWith('cl', 'column-new-2');
    expect(mock.setBlockParent).toHaveBeenCalledWith('p', 'column-new-3');

    // descendant columns are never reparented — they ride inside cl
    expect(mock.setBlockParent).not.toHaveBeenCalledWith('colA', expect.anything());
    expect(mock.setBlockParent).not.toHaveBeenCalledWith('colB', expect.anything());
  });

  it('animates nothing (keyboard path keeps instant layout)', () => {
    const mock = createMockAPI([
      { id: 'a', parentId: null, index: 2 },
      { id: 'b', parentId: null, index: 3 },
    ]);

    wrapBlocksInColumns(mock.api, ['a', 'b']);

    expect(animateColumnWidths).not.toHaveBeenCalled();
  });

  it('wraps two selected column_lists as two nested columns, ignoring all their descendants', () => {
    const mock = createMockAPI([
      { id: 'clX', parentId: null, index: 2 },
      { id: 'xA', parentId: 'clX', index: 3 },
      { id: 'clY', parentId: null, index: 4 },
      { id: 'yA', parentId: 'clY', index: 5 },
    ]);

    const result = wrapBlocksInColumns(mock.api, ['clX', 'xA', 'clY', 'yA']);

    expect(result).toBe('column_list-new-1');
    expect(mock.created).toHaveLength(3); // list + 2 columns
    expect(mock.setBlockParent).toHaveBeenCalledWith('clX', 'column-new-2');
    expect(mock.setBlockParent).toHaveBeenCalledWith('clY', 'column-new-3');

    expect(mock.setBlockParent).not.toHaveBeenCalledWith('xA', expect.anything());
    expect(mock.setBlockParent).not.toHaveBeenCalledWith('yA', expect.anything());
  });
});

describe('drop animation wiring', () => {
  const makeMeasuredHolder = (width: number): HTMLElement => {
    const holder = document.createElement('div');

    vi.spyOn(holder, 'getBoundingClientRect').mockReturnValue({ width, top: 0 } as DOMRect);

    return holder;
  };

  describe('wrapInNewColumnList', () => {
    it('side right: animates [target, sources] columns from [targetWidth, 0]', () => {
      const targetHolder = makeMeasuredHolder(600);
      const mock = createMockAPI([
        { id: 'target', parentId: null, index: 4, holder: targetHolder },
        { id: 'src', parentId: null, index: 9 },
      ]);

      wrapInNewColumnList(mock.api, 'target', ['src'], 'right');

      const firstColumnHolder = mock.created[1].holder;
      const secondColumnHolder = mock.created[2].holder;

      expect(animateColumnWidths).toHaveBeenCalledWith({
        holders: [firstColumnHolder, secondColumnHolder],
        startWidths: [600, 0],
        newColumnHolder: secondColumnHolder,
      });
    });

    it('side left: sources column is first, so start widths reverse', () => {
      const targetHolder = makeMeasuredHolder(600);
      const mock = createMockAPI([
        { id: 'target', parentId: null, index: 4, holder: targetHolder },
        { id: 'src', parentId: null, index: 9 },
      ]);

      wrapInNewColumnList(mock.api, 'target', ['src'], 'left');

      const firstColumnHolder = mock.created[1].holder;
      const secondColumnHolder = mock.created[2].holder;

      expect(animateColumnWidths).toHaveBeenCalledWith({
        holders: [firstColumnHolder, secondColumnHolder],
        startWidths: [0, 600],
        newColumnHolder: firstColumnHolder,
      });
    });

    it('captures sibling tops from the target BEFORE the mutation and plays the shift after', () => {
      const targetHolder = makeMeasuredHolder(600);
      const captured = [{ element: document.createElement('div'), top: 42 }];

      vi.mocked(captureSiblingTops).mockReturnValueOnce(captured);

      const mock = createMockAPI([
        { id: 'target', parentId: null, index: 4, holder: targetHolder },
        { id: 'src', parentId: null, index: 9 },
      ]);

      wrapInNewColumnList(mock.api, 'target', ['src'], 'right');

      expect(captureSiblingTops).toHaveBeenCalledWith(targetHolder);
      expect(playSiblingShift).toHaveBeenCalledWith(captured);
    });

    it('skips the animation when the target holder is unavailable', () => {
      const mock = createMockAPI([
        { id: 'target', parentId: null, index: 4 },
        { id: 'src', parentId: null, index: 9 },
      ]);

      wrapInNewColumnList(mock.api, 'target', ['src'], 'right');

      expect(animateColumnWidths).not.toHaveBeenCalled();
      expect(playSiblingShift).not.toHaveBeenCalled();
    });

    it('does not animate on an aborted (self-drop) wrap', () => {
      const mock = createMockAPI([
        { id: 'target', parentId: null, index: 4, holder: makeMeasuredHolder(600) },
      ]);

      wrapInNewColumnList(mock.api, 'target', ['target'], 'right');

      expect(animateColumnWidths).not.toHaveBeenCalled();
      expect(playSiblingShift).not.toHaveBeenCalled();
    });
  });

  describe('addColumnToList', () => {
    const seedList = () => {
      const listHolder = makeMeasuredHolder(620);
      const holderA = makeMeasuredHolder(400);
      const holderB = makeMeasuredHolder(200);
      const newHolder = makeMeasuredHolder(0);
      const mock = createMockAPI([
        { id: 'cl', parentId: null, index: 2, holder: listHolder },
        { id: 'neighbor', parentId: 'cl', index: 3, holder: holderA },
        { id: 's1', parentId: null, index: 9 },
      ]);

      mock.childrenByParent.set('cl', [
        { id: 'neighbor', holder: holderA },
        { id: 'colB', holder: holderB },
        { id: 'column-new-1', holder: newHolder },
      ]);

      return { mock, listHolder, holderA, holderB, newHolder };
    };

    it('animates the grown row from the pre-drop widths, new column at 0', () => {
      const { mock, holderA, holderB, newHolder } = seedList();

      addColumnToList(mock.api, 'neighbor', ['s1'], 'right');

      expect(animateColumnWidths).toHaveBeenCalledWith({
        holders: [holderA, holderB, newHolder],
        startWidths: [400, 200, 0],
        newColumnHolder: newHolder,
      });
    });

    it('captures sibling tops from the column_list holder and plays the shift', () => {
      const { mock, listHolder } = seedList();
      const captured = [{ element: document.createElement('div'), top: 7 }];

      vi.mocked(captureSiblingTops).mockReturnValueOnce(captured);

      addColumnToList(mock.api, 'neighbor', ['s1'], 'right');

      expect(captureSiblingTops).toHaveBeenCalledWith(listHolder);
      expect(playSiblingShift).toHaveBeenCalledWith(captured);
    });

    it('does not animate on an aborted add (stale neighbor)', () => {
      const mock = createMockAPI([
        { id: 's1', parentId: null, index: 9 },
      ]);

      addColumnToList(mock.api, 'neighbor', ['s1'], 'right');

      expect(animateColumnWidths).not.toHaveBeenCalled();
      expect(playSiblingShift).not.toHaveBeenCalled();
    });
  });
});
