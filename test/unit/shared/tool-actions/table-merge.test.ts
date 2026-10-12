// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { TABLE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/table';
import { TABLE_ACTIONS } from '../../../../src/shared/tool-descriptions/table';
import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

import type { ToolActionImpl } from '../../../../types/tools/tool-description';
import type { FakeCtx } from './fake-ctx';

type Cell = { blocks: string[]; colspan?: number; rowspan?: number; mergedInto?: number[] };

const handler = (name: string): ToolActionImpl => {
  const found = TABLE_ACTION_HANDLERS[name];

  if (found === undefined) {
    throw new Error(`Missing table handler "${name}".`);
  }

  return found;
};

const make = (rows = 2, cols = 2): { ctx: FakeCtx; id: string; childIds: string[] } => {
  const seed = createFakeCtx(docOf([]), undefined, 'table');
  const { id, childIds } = handler('create').run(seed, { rows, cols }, undefined) as { id: string; childIds: string[] };

  return { ctx: createFakeCtx(seed.doc, id), id, childIds };
};

const cells = (ctx: FakeCtx, id: string): Cell[][] => (ctx.read(id)?.data as { content: Cell[][] }).content;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('table.mergeCells / splitCell', () => {
  it('merges a 2x2 range into its top-left cell, keeping every block', () => {
    const { ctx, id, childIds } = make();

    handler('mergeCells').run(ctx, { range: { fromRow: 1, fromCol: 1, toRow: 0, toCol: 0 } }, undefined);
    const grid = cells(ctx, id);

    expect(grid[0][0]).toMatchObject({ colspan: 2, rowspan: 2, blocks: childIds });
    expect(grid[1][1].mergedInto).toEqual([0, 0]);
    expect(childIds.every(child => ctx.read(child) !== null)).toBe(true);
    expect(ctx.edits.every(edit => edit.op === 'update')).toBe(true);
  });

  it('refuses a single-cell merge', () => {
    expect(() => handler('mergeCells').run(make().ctx, { range: { fromRow: 0, fromCol: 0, toRow: 0, toCol: 0 } }, undefined)).toThrow(FakeFailure);
  });

  it('refuses a range that cuts through a merge or leaves the table', () => {
    const { ctx, id } = make(2, 3);

    handler('mergeCells').run(ctx, { range: { fromRow: 0, fromCol: 0, toRow: 1, toCol: 0 } }, undefined);
    const merged = createFakeCtx(ctx.doc, id);

    expect(() => handler('mergeCells').run(merged, { range: { fromRow: 0, fromCol: 0, toRow: 0, toCol: 1 } }, undefined)).toThrow(/cannot merge/);
    expect(() => handler('mergeCells').run(merged, { range: { fromRow: 0, fromCol: 1, toRow: 0, toCol: 3 } }, undefined)).toThrow(/cannot merge/);
    expect(merged.edits).toEqual([]);
  });

  it('splits back and seeds the freed cells', () => {
    const { ctx, id, childIds } = make();

    handler('mergeCells').run(ctx, { range: { fromRow: 0, fromCol: 0, toRow: 0, toCol: 1 } }, undefined);
    handler('splitCell').run(createFakeCtx(ctx.doc, id), { row: 0, col: 0 }, undefined);
    const [row] = cells(ctx, id);

    expect(row[0].colspan).toBeUndefined();
    expect(row[0].blocks).toEqual([childIds[0], childIds[1]]);
    expect(row[1].mergedInto).toBeUndefined();
    expect(row[1].blocks).toHaveLength(1);
    expect(ctx.read(row[1].blocks[0])).toMatchObject({ type: 'paragraph', parentId: id, data: { text: [] } });
  });

  it('keeps legacy text across a merge and split instead of hiding it under a new paragraph', () => {
    const doc = docOf([{
      id: 't', type: 'table',
      data: {
        withHeadings: false, withHeadingColumn: false,
        content: [[{ blocks: [], id: 'c0', rowId: 'r0', text: 'Left' }, { blocks: [], id: 'c1', rowId: 'r0', text: 'Right' }]],
      },
    }]);
    const ctx = createFakeCtx(doc, 't');

    handler('mergeCells').run(ctx, { range: { fromRow: 0, fromCol: 0, toRow: 0, toCol: 1 } }, undefined);
    handler('splitCell').run(createFakeCtx(doc, 't'), { row: 0, col: 0 }, undefined);

    expect(cells(ctx, 't')[0]).toEqual([
      { blocks: [], id: 'c0', rowId: 'r0', text: 'Left' },
      { blocks: [], id: 'c1', rowId: 'r0', text: 'Right' },
    ]);
  });

  it('refuses to split a cell that is not merged', () => {
    expect(() => handler('splitCell').run(make().ctx, { row: 0, col: 0 }, undefined)).toThrow(/not a merged cell/);
  });
});

describe('merge declarations', () => {
  it('mergeCells takes a range and splitCell takes row and col', () => {
    const merge = TABLE_ACTIONS.find(action => action.name === 'mergeCells')?.args ?? {};
    const split = TABLE_ACTIONS.find(action => action.name === 'splitCell')?.args ?? {};

    expect(validateAgainst(merge, { range: { fromRow: 0, fromCol: 0, toRow: 1, toCol: 1 } })).toEqual([]);
    expect(validateAgainst(merge, {}).length).toBeGreaterThan(0);
    expect(validateAgainst(split, { row: 0, col: 1 })).toEqual([]);
    expect(validateAgainst(split, { row: 0 }).length).toBeGreaterThan(0);
    expect(BUILT_IN_TOOL_RUNTIMES.get('table')?.actions.mergeCells).toBe(handler('mergeCells'));
    expect(BUILT_IN_TOOL_RUNTIMES.get('table')?.actions.splitCell).toBe(handler('splitCell'));
  });
});
