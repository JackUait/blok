// @vitest-environment node
import { nanoid } from 'nanoid';
import type * as NanoidModule from 'nanoid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  alignRowsToColumns,
  cellKey,
  ensureTableIds,
  generateTableId,
  mergePaddedCells,
  pickTableIds,
} from '../../../../src/tools/table/table-ids';
import { alignRowsToColumns as sharedAlignRowsToColumns, ensureTableIdsWith } from '../../../../src/shared/table/table-ids';
import type { CellContent } from '../../../../src/tools/table/types';

vi.mock('nanoid', async importOriginal => {
  const original = await importOriginal<typeof NanoidModule>();

  return { ...original, nanoid: vi.fn() };
});

const counter = (): (() => string) => {
  let n = 0;

  return () => `id${++n}`;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(nanoid).mockImplementation(counter());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each([
  { name: 'editor', ensure: ensureTableIds, align: alignRowsToColumns },
  { name: 'shared', ensure: (grid: CellContent[][]) => ensureTableIdsWith(grid, counter()), align: sharedAlignRowsToColumns },
])('$name table ids', ({ ensure, align }) => {
  it('mints columns before rows and shares each id across its slot', () => {
    expect(ensure([
      [{ blocks: ['a'] }, { blocks: ['b'] }],
      [{ blocks: ['c'] }, { blocks: ['d'] }],
    ])).toEqual([
      [{ blocks: ['a'], id: 'id1', rowId: 'id3' }, { blocks: ['b'], id: 'id2', rowId: 'id3' }],
      [{ blocks: ['c'], id: 'id1', rowId: 'id4' }, { blocks: ['d'], id: 'id2', rowId: 'id4' }],
    ]);
  });

  it('takes the first valid unused candidate from later cells', () => {
    expect(ensure([
      [
        { blocks: ['a'], id: 'dup', rowId: '' },
        { blocks: ['b'], id: 'dup', rowId: 'r0' },
        { blocks: ['c'], id: '', rowId: 'r0' },
      ],
      [
        { blocks: ['d'], id: 'other', rowId: 'r0' },
        { blocks: ['e'], id: 'c1', rowId: 'r0' },
        { blocks: ['f'], id: 'c2', rowId: 'r1' },
      ],
    ])).toEqual([
      [
        { blocks: ['a'], id: 'dup', rowId: 'r0' },
        { blocks: ['b'], id: 'c1', rowId: 'r0' },
        { blocks: ['c'], id: 'c2', rowId: 'r0' },
      ],
      [
        { blocks: ['d'], id: 'dup', rowId: 'r1' },
        { blocks: ['e'], id: 'c1', rowId: 'r1' },
        { blocks: ['f'], id: 'c2', rowId: 'r1' },
      ],
    ]);
  });

  it('replaces duplicated column and row ids after their first slots', () => {
    expect(ensure([
      [{ blocks: ['a'], id: 'dup', rowId: 'row' }, { blocks: ['b'], id: 'dup', rowId: 'row' }],
      [{ blocks: ['c'], id: 'dup', rowId: 'row' }, { blocks: ['d'], id: 'dup', rowId: 'row' }],
    ])).toEqual([
      [{ blocks: ['a'], id: 'dup', rowId: 'row' }, { blocks: ['b'], id: 'id1', rowId: 'row' }],
      [{ blocks: ['c'], id: 'dup', rowId: 'id2' }, { blocks: ['d'], id: 'id1', rowId: 'id2' }],
    ]);
  });

  it('uses the widest column count without filling ragged or empty rows', () => {
    expect(ensure([[], [{ blocks: ['a'] }], [{ blocks: ['b'] }, { blocks: ['c'] }]])).toEqual([
      [],
      [{ blocks: ['a'], id: 'id1', rowId: 'id4' }],
      [{ blocks: ['b'], id: 'id1', rowId: 'id5' }, { blocks: ['c'], id: 'id2', rowId: 'id5' }],
    ]);
    expect(ensure([])).toEqual([]);
  });

  it('keeps metadata and unknown properties without mutating input cells', () => {
    const cell: CellContent & { extra: { note: string } } = {
      blocks: ['a'],
      color: 'red',
      textColor: 'black',
      text: '<b>A</b>',
      blockData: [{ tool: 'paragraph', data: { text: 'A' } }],
      placement: 'bottom-right',
      colspan: 2,
      rowspan: 3,
      mergedInto: [0, 1],
      extra: { note: 'keep' },
    };
    const input: CellContent[][] = [[cell]];

    Object.freeze(cell.blocks);
    Object.freeze(cell);
    Object.freeze(input[0]);
    Object.freeze(input);

    const result = ensure(input);

    expect(result).toEqual([[{
      blocks: ['a'],
      color: 'red',
      textColor: 'black',
      text: '<b>A</b>',
      blockData: [{ tool: 'paragraph', data: { text: 'A' } }],
      placement: 'bottom-right',
      colspan: 2,
      rowspan: 3,
      mergedInto: [0, 1],
      extra: { note: 'keep' },
      id: 'id1',
      rowId: 'id2',
    }]]);
    expect(cell.id).toBeUndefined();
    expect(cell.rowId).toBeUndefined();
    expect(result).not.toBe(input);
    expect(result[0]).not.toBe(input[0]);
    expect(result[0]?.[0]).not.toBe(cell);
    expect(result[0]?.[0]?.blocks).toBe(cell.blocks);
    expect(result[0]?.[0]?.blockData).toBe(cell.blockData);
  });

  it('aligns to the first widest row and pads missing columns in place', () => {
    const first: CellContent & { extra: string } = { blocks: ['a'], id: 'c0', rowId: 'r0', extra: 'keep' };
    const last: CellContent = { blocks: ['b'], id: 'c1', rowId: 'r0' };
    const input: CellContent[][] = [
      [first, last],
      [{ blocks: ['x'], id: 'c0' }, { blocks: ['new'], id: 'cN' }, { blocks: ['y'], id: 'c1' }],
      [{ blocks: ['q'], id: 'c1' }, { blocks: ['p'], id: 'cN' }, { blocks: ['o'], id: 'c0' }],
    ];
    const before = structuredClone(input);

    input.forEach(row => {
      row.forEach(cell => Object.freeze(cell));
      Object.freeze(row);
    });
    Object.freeze(input);

    const result = align(input);

    expect(result).toEqual([
      [
        { blocks: ['a'], id: 'c0', rowId: 'r0', extra: 'keep' },
        { blocks: [], id: 'cN', rowId: 'r0' },
        { blocks: ['b'], id: 'c1', rowId: 'r0' },
      ],
      [{ blocks: ['x'], id: 'c0' }, { blocks: ['new'], id: 'cN' }, { blocks: ['y'], id: 'c1' }],
      [{ blocks: ['o'], id: 'c0' }, { blocks: ['p'], id: 'cN' }, { blocks: ['q'], id: 'c1' }],
    ]);
    expect(input).toEqual(before);
    expect(result[0]?.[0]).toBe(first);
    expect(result[0]?.[2]).toBe(last);
    expect(result[1]).toBe(input[1]);
  });

  it('keeps unknown, missing and duplicated column ids positional', () => {
    const input: CellContent[][] = [
      [{ blocks: [], id: 'c0' }, { blocks: [], id: 'c1' }],
      [{ blocks: ['unknown'], id: 'other' }],
      [{ blocks: ['missing'] }],
      [{ blocks: ['duplicate1'], id: 'c0' }, { blocks: ['duplicate2'], id: 'c0' }],
      [{ blocks: ['empty'], id: '' }],
    ];
    const result = align(input);

    expect(result).toEqual(input);
    input.forEach((row, index) => expect(result[index]).toBe(row));
  });

  it('ignores an invalid widest row when choosing canonical columns', () => {
    expect(align([
      [{ blocks: ['a'], id: 'c1' }],
      [{ blocks: ['x'], id: 'dup' }, { blocks: ['y'], id: 'dup' }, { blocks: ['z'], id: 'other' }],
      [{ blocks: [], id: 'c0' }, { blocks: [], id: 'c1' }],
    ])).toEqual([
      [{ blocks: [], id: 'c0' }, { blocks: ['a'], id: 'c1' }],
      [{ blocks: ['x'], id: 'dup' }, { blocks: ['y'], id: 'dup' }, { blocks: ['z'], id: 'other' }],
      [{ blocks: [], id: 'c0' }, { blocks: [], id: 'c1' }],
    ]);
  });

  it('does not invent a row id when aligning a row that has none', () => {
    const result = align([[{ blocks: [], id: 'c0' }, { blocks: [], id: 'c1' }], [], [{ blocks: ['a'], id: 'c1' }]]);

    expect(result).toEqual([
      [{ blocks: [], id: 'c0' }, { blocks: [], id: 'c1' }],
      [{ blocks: [], id: 'c0' }, { blocks: [], id: 'c1' }],
      [{ blocks: [], id: 'c0' }, { blocks: ['a'], id: 'c1' }],
    ]);
    expect(result[1]?.[0]).not.toHaveProperty('rowId');
  });

  it('returns the same grid when no row has usable column ids', () => {
    const input: CellContent[][] = [[{ blocks: ['a'] }], [{ blocks: ['b'], id: '' }]];

    expect(align(input)).toBe(input);
    expect(align([])).toEqual([]);
  });
});

describe('editor-only table id helpers', () => {
  it('keeps nanoid as the editor minter with ten-character requests', () => {
    expect(generateTableId()).toBe('id1');
    expect(ensureTableIds([[{ blocks: [] }]])).toEqual([[{ blocks: [], id: 'id2', rowId: 'id3' }]]);
    expect(vi.mocked(nanoid).mock.calls).toEqual([[10], [10], [10]]);
  });

  it('picks only valid ids without changing a cell', () => {
    const cell: CellContent = { blocks: ['a'], id: 'c0', rowId: 'r0', color: 'red' };

    expect(pickTableIds(cell)).toEqual({ id: 'c0', rowId: 'r0' });
    expect(pickTableIds({ blocks: [], id: '', rowId: '' })).toEqual({});
    expect(pickTableIds({ blocks: [] })).toEqual({});
    expect(cell).toEqual({ blocks: ['a'], id: 'c0', rowId: 'r0', color: 'red' });
  });

  it('finds only empty unmerged cells missing from a known stored row', () => {
    const stored: unknown = [
      [{ blocks: [], id: 'c0', rowId: 'r0' }],
      [{ blocks: [], id: 'c0', rowId: 'bad' }, { blocks: [], id: 'c1', rowId: 'other' }],
      ['legacy'],
      null,
    ];

    expect([...mergePaddedCells(stored, [
      [
        { blocks: [], id: 'c0', rowId: 'r0' },
        { blocks: [], id: 'c1', rowId: 'r0' },
        { blocks: ['typed'], id: 'c2', rowId: 'r0' },
        { blocks: [], id: 'c3', rowId: 'r0', mergedInto: [0, 0] },
      ],
      [{ blocks: [], id: 'c1', rowId: 'unknown' }],
      [{ blocks: [], id: 'c2', rowId: 'bad' }],
      ['legacy', { blocks: [], id: '', rowId: 'r0' }, { blocks: [] }],
    ])]).toEqual(['r0:c1']);
    expect(cellKey('r0', 'c1')).toBe('r0:c1');
    expect([...mergePaddedCells(undefined, [[{ blocks: [], id: 'c0', rowId: 'r0' }]])]).toEqual([]);
  });
});

describe('ensureTableIdsWith', () => {
  it('uses the injected minter only for missing slots', () => {
    const mint = vi.fn(counter());

    expect(ensureTableIdsWith([
      [{ blocks: [], id: 'c0', rowId: 'r0' }, { blocks: [], rowId: 'r0' }],
      [{ blocks: [] }, { blocks: [] }],
    ], mint)).toEqual([
      [{ blocks: [], id: 'c0', rowId: 'r0' }, { blocks: [], id: 'id1', rowId: 'r0' }],
      [{ blocks: [], id: 'c0', rowId: 'id2' }, { blocks: [], id: 'id1', rowId: 'id2' }],
    ]);
    expect(mint).toHaveBeenCalledTimes(2);
    expect(nanoid).not.toHaveBeenCalled();
  });
});
