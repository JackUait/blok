// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { TABLE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/table';
import { TABLE_ACTIONS } from '../../../../src/shared/tool-descriptions/table';
import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

import type { ToolActionImpl } from '../../../../types/tools/tool-description';
import type { FakeCtx } from './fake-ctx';

type Cell = { blocks: string[]; color?: string; textColor?: string; placement?: string; text?: string };

const handler = (name: string): ToolActionImpl => {
  const found = TABLE_ACTION_HANDLERS[name];

  if (found === undefined) {
    throw new Error(`Missing table handler "${name}".`);
  }

  return found;
};

const make = (rows = 2, cols = 2): { ctx: FakeCtx; id: string; childIds: string[] } => {
  const seed = createFakeCtx(docOf([]), undefined, 'table');
  const { id, childIds } = handler('create').run(seed, { rows, cols, cells: [[[{ text: 'src' }], [{ text: 'right' }]]] }, undefined) as { id: string; childIds: string[] };

  return { ctx: createFakeCtx(seed.doc, id), id, childIds };
};

const cells = (ctx: FakeCtx, id: string): Cell[][] => (ctx.read(id)?.data as { content: Cell[][] }).content;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('table.styleCells', () => {
  it('colours and places a range, and null clears', () => {
    const { ctx, id } = make();

    handler('styleCells').run(ctx, { range: { fromRow: 0, fromCol: 0, toRow: 1, toCol: 0 }, color: 'red', textColor: '#333', placement: 'middle-center' }, undefined);
    expect(cells(ctx, id).map(row => [row[0].color, row[0].textColor, row[0].placement])).toEqual([
      ['red', '#333', 'middle-center'], ['red', '#333', 'middle-center'],
    ]);
    expect(cells(ctx, id)[0][1].color).toBeUndefined();
    handler('styleCells').run(createFakeCtx(ctx.doc, id), { range: { fromRow: 0, fromCol: 0, toRow: 0, toCol: 0 }, color: null }, undefined);
    expect(cells(ctx, id)[0][0].color).toBeUndefined();
    expect(cells(ctx, id)[0][0].placement).toBe('middle-center');
  });

  it('refuses a style call that sets nothing', () => {
    expect(() => handler('styleCells').run(make().ctx, { range: { fromRow: 0, fromCol: 0, toRow: 0, toCol: 0 } }, undefined)).toThrow(FakeFailure);
  });

  it.each([{ color: 'url(x)' }, { textColor: 'red; background: blue' }])('refuses an unsafe colour %j and writes nothing', style => {
    const { ctx } = make();

    expect(() => handler('styleCells').run(ctx, { range: { fromRow: 0, fromCol: 0, toRow: 0, toCol: 0 }, ...style }, undefined))
      .toThrow(/not a colour the table accepts/);
    expect(ctx.edits).toEqual([]);
  });

  it('accepts a colour when the range starts on a covered cell', () => {
    const { ctx, id } = make();

    ctx.update(id, { content: [
      [{ ...cells(ctx, id)[0][0], colspan: 2 }, { ...cells(ctx, id)[0][1], blocks: [], mergedInto: [0, 0] }],
      cells(ctx, id)[1],
    ] });
    handler('styleCells').run(ctx, { range: { fromRow: 0, fromCol: 1, toRow: 1, toCol: 1 }, color: 'blue' }, undefined);

    expect(cells(ctx, id)[1][1].color).toBe('blue');
  });

  it('refuses a range outside the table', () => {
    expect(() => handler('styleCells').run(make().ctx, { range: { fromRow: 2, fromCol: 0, toRow: 2, toCol: 0 }, color: 'red' }, undefined))
      .toThrow(/indices start at 0/);
  });
});

describe('table.fillCells', () => {
  it('fills down with copies of the top cell and removes what was there', () => {
    const { ctx, id, childIds } = make();

    handler('fillCells').run(ctx, { range: { fromRow: 0, fromCol: 0, toRow: 1, toCol: 0 }, direction: 'down' }, undefined);
    const [[top], [bottom]] = cells(ctx, id);

    expect(bottom.blocks).toHaveLength(1);
    expect(bottom.blocks[0]).not.toBe(top.blocks[0]);
    expect(ctx.read(bottom.blocks[0])?.data).toEqual({ text: [{ text: 'src' }] });
    expect(ctx.read(childIds[2])).toBeNull();
    expect(cells(ctx, id)[1][1].blocks).toEqual([childIds[3]]);
  });

  it('fills right from the first column of each row', () => {
    const { ctx, id, childIds } = make(2, 3);

    handler('fillCells').run(ctx, { range: { fromRow: 0, fromCol: 0, toRow: 0, toCol: 2 }, direction: 'right' }, undefined);
    const [row, untouched] = cells(ctx, id);

    expect(row.map(cell => ctx.read(cell.blocks[0])?.data)).toEqual([
      { text: [{ text: 'src' }] }, { text: [{ text: 'src' }] }, { text: [{ text: 'src' }] },
    ]);
    expect(untouched.map(cell => cell.blocks[0])).toEqual(childIds.slice(3));
  });

  it('copies a covered source from its merge origin', () => {
    const { ctx, id, childIds } = make(2, 2);
    const grid = cells(ctx, id);

    ctx.update(id, { content: [
      [{ ...grid[0][0], blocks: [childIds[0], childIds[1]], colspan: 2 }, { ...grid[0][1], blocks: [], mergedInto: [0, 0] }],
      grid[1],
    ] });
    handler('fillCells').run(ctx, { range: { fromRow: 0, fromCol: 1, toRow: 1, toCol: 1 }, direction: 'down' }, undefined);

    expect(cells(ctx, id)[1][1].blocks.map(block => ctx.read(block)?.data)).toEqual([
      { text: [{ text: 'src' }] }, { text: [{ text: 'right' }] },
    ]);
  });
});

describe('style and fill declarations', () => {
  const range = { fromRow: 0, fromCol: 0, toRow: 0, toCol: 0 };

  it('styleCells takes nullable colours and a 9-way placement', () => {
    const args = TABLE_ACTIONS.find(action => action.name === 'styleCells')?.args ?? {};

    expect(validateAgainst(args, { range, color: null, textColor: 'red', placement: 'bottom-right' })).toEqual([]);
    expect(validateAgainst(args, { range, placement: null })).toEqual([]);
    expect(validateAgainst(args, { range, placement: 'middle' }).length).toBeGreaterThan(0);
    expect(validateAgainst(args, { color: 'red' }).length).toBeGreaterThan(0);
    expect(BUILT_IN_TOOL_RUNTIMES.get('table')?.actions.styleCells).toBe(handler('styleCells'));
  });

  it('fillCells takes a range and a direction', () => {
    const args = TABLE_ACTIONS.find(action => action.name === 'fillCells')?.args ?? {};

    expect(validateAgainst(args, { range, direction: 'down' })).toEqual([]);
    expect(validateAgainst(args, { range, direction: 'up' }).length).toBeGreaterThan(0);
    expect(BUILT_IN_TOOL_RUNTIMES.get('table')?.actions.fillCells).toBe(handler('fillCells'));
  });
});
