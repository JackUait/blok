// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TABLE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/table';
import { createFakeCtx, docOf } from './fake-ctx';

import type { ToolActionImpl } from '../../../../types/tools/tool-description';
import type { FakeCtx } from './fake-ctx';

type Cell = { blocks: string[]; mergedInto?: number[] };

const handler = (name: string): ToolActionImpl => {
  const found = TABLE_ACTION_HANDLERS[name];

  if (found === undefined) {
    throw new Error(`Missing table handler "${name}".`);
  }

  return found;
};

const make = (rows: number, cols: number): { ctx: FakeCtx; id: string } => {
  const seed = createFakeCtx(docOf([]), undefined, 'table');
  const { id } = handler('create').run(seed, { rows, cols, cells: [[[{ text: 'a' }], [{ text: 'b' }]], [[{ text: 'c' }]]] }, undefined) as { id: string };

  return { ctx: createFakeCtx(seed.doc, id), id };
};

// The editor keeps a table's children in grid order: row by row, each cell's blocks in order.
const gridOrder = (ctx: FakeCtx, id: string): string[] =>
  (ctx.read(id)?.data as { content: Cell[][] }).content.flat().flatMap(cell => cell.blocks);

const childOrder = (ctx: FakeCtx, id: string): string[] => [...(ctx.read(id)?.children ?? [])];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('table actions keep the table children in grid order', () => {
  it.each([
    ['insertRows at the top', 'insertRows', { at: 0, count: 2 }],
    ['insertRows in the middle', 'insertRows', { at: 1 }],
    ['insertColumns at the left', 'insertColumns', { at: 0 }],
    ['insertColumns in the middle', 'insertColumns', { at: 1, count: 2 }],
    ['duplicateRows', 'duplicateRows', { at: 0 }],
    ['duplicateColumns', 'duplicateColumns', { at: 0 }],
    ['fillCells down', 'fillCells', { range: { fromRow: 0, fromCol: 0, toRow: 2, toCol: 1 }, direction: 'down' }],
    ['fillCells right', 'fillCells', { range: { fromRow: 0, fromCol: 0, toRow: 1, toCol: 1 }, direction: 'right' }],
    ['clearCells', 'clearCells', { range: { fromRow: 0, fromCol: 0, toRow: 1, toCol: 0 } }],
  ])('%s', (_label, name, args) => {
    const { ctx, id } = make(3, 2);

    handler(name).run(ctx, args, undefined);

    expect(childOrder(ctx, id)).toEqual(gridOrder(ctx, id));
  });

  it('a merge moves the absorbed blocks right after the origin cell\'s blocks, as the editor does', () => {
    const { ctx, id } = make(2, 3);

    handler('mergeCells').run(ctx, { range: { fromRow: 0, fromCol: 0, toRow: 1, toCol: 1 } }, undefined);

    expect(childOrder(ctx, id)).toEqual(gridOrder(ctx, id));
  });

  it('a split seeds freed cells at their grid slot', () => {
    const { ctx, id } = make(2, 3);

    handler('mergeCells').run(ctx, { range: { fromRow: 0, fromCol: 0, toRow: 1, toCol: 1 } }, undefined);
    handler('splitCell').run(createFakeCtx(ctx.doc, id), { row: 0, col: 0 }, undefined);

    expect(childOrder(ctx, id)).toEqual(gridOrder(ctx, id));
  });

  it('a duplicated multi-block cell keeps its blocks in order', () => {
    const { ctx, id } = make(2, 1);
    const first = (ctx.read(id)?.data as { content: Cell[][] }).content[0][0].blocks[0];

    handler('fillCells').run(ctx, { range: { fromRow: 0, fromCol: 0, toRow: 1, toCol: 0 }, direction: 'down' }, undefined);
    handler('mergeCells').run(createFakeCtx(ctx.doc, id), { range: { fromRow: 0, fromCol: 0, toRow: 1, toCol: 0 } }, undefined);
    handler('splitCell').run(createFakeCtx(ctx.doc, id), { row: 0, col: 0 }, undefined);
    handler('duplicateRows').run(createFakeCtx(ctx.doc, id), { at: 0 }, undefined);

    expect((ctx.read(id)?.data as { content: Cell[][] }).content[0][0].blocks[0]).toBe(first);
    expect(childOrder(ctx, id)).toEqual(gridOrder(ctx, id));
  });
});
