// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { TABLE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/table';
import { TABLE_ACTIONS } from '../../../../src/shared/tool-descriptions/table';
import { createFakeCtx, docOf } from './fake-ctx';

import type { ToolActionImpl } from '../../../../types/tools/tool-description';
import type { FakeCtx } from './fake-ctx';

type Cell = { blocks: string[]; id?: string; rowId?: string; color?: string; textColor?: string; placement?: string; text?: string };

const handler = (name: string): ToolActionImpl => {
  const found = TABLE_ACTION_HANDLERS[name];

  if (found === undefined) {
    throw new Error(`Missing table handler "${name}".`);
  }

  return found;
};

const make = (rows: number, cols: number, extra: Record<string, unknown> = {}): { ctx: FakeCtx; id: string; childIds: string[] } => {
  const seed = createFakeCtx(docOf([]), undefined, 'table');
  const { id, childIds } = handler('create').run(seed, { rows, cols, cells: [[[{ text: 'a' }], [{ text: 'b' }]]] }, undefined) as { id: string; childIds: string[] };

  seed.update(id, extra);

  return { ctx: createFakeCtx(seed.doc, id), id, childIds };
};

const content = (ctx: FakeCtx, id: string): Cell[][] => (ctx.read(id)?.data as { content: Cell[][] }).content;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('table.duplicateRows / duplicateColumns', () => {
  it('copies a row after itself with fresh blocks of the same text and colour', () => {
    const { ctx, id } = make(2, 2);

    handler('styleCells').run(ctx, { range: { fromRow: 0, fromCol: 0, toRow: 0, toCol: 0 }, color: 'red', placement: 'bottom-right' }, undefined);
    handler('duplicateRows').run(createFakeCtx(ctx.doc, id), { at: 0 }, undefined);
    const [first, copy, last] = content(ctx, id);

    expect(content(ctx, id)).toHaveLength(3);
    expect(copy[0].blocks[0]).not.toBe(first[0].blocks[0]);
    expect(ctx.read(copy[0].blocks[0])?.data).toEqual({ text: [{ text: 'a' }] });
    expect(ctx.read(copy[1].blocks[0])?.data).toEqual({ text: [{ text: 'b' }] });
    expect(copy.map(cell => cell.id)).toEqual(first.map(cell => cell.id));
    expect(copy[0].rowId).not.toBe(first[0].rowId);
    expect([copy[0].color, copy[0].placement]).toEqual(['red', 'bottom-right']);
    expect(copy[1].color).toBeUndefined();
    expect(last[0].blocks[0]).not.toBe(copy[0].blocks[0]);
  });

  it('deep-copies nested blocks and places copies of a range after the whole range', () => {
    const { ctx, id, childIds } = make(1, 3, { colWidths: [100, 200, 300] });

    ctx.insert({ type: 'paragraph', data: { text: [{ text: 'nested' }] }, parentId: childIds[0] });
    handler('duplicateColumns').run(ctx, { at: 0, count: 2 }, undefined);
    const [row] = content(ctx, id);
    const copy = row[2].blocks[0];
    const nestedCopy = ctx.read(copy)?.children[0] ?? '';

    expect(row.map(cell => cell.blocks[0]).slice(0, 2)).toEqual(childIds.slice(0, 2));
    expect(row[4].blocks).toEqual([childIds[2]]);
    expect(ctx.read(copy)).toMatchObject({ type: 'paragraph', parentId: id, data: { text: [{ text: 'a' }] } });
    expect(ctx.read(nestedCopy)).toMatchObject({ parentId: copy, data: { text: [{ text: 'nested' }] } });
    expect((ctx.read(id)?.data as { colWidths: number[] }).colWidths).toEqual([100, 200, 100, 200, 300]);
    expect(row.map(cell => cell.id)).toHaveLength(5);
    expect(new Set(row.map(cell => cell.id)).size).toBe(5);
  });

  it('copies a legacy text-only cell as text instead of an empty paragraph', () => {
    const doc = docOf([{
      id: 't', type: 'table',
      data: { withHeadings: false, withHeadingColumn: false, content: [[{ blocks: [], id: 'c0', rowId: 'r0', text: '<b>Old</b>' }]] },
    }]);
    const ctx = createFakeCtx(doc, 't');

    handler('duplicateRows').run(ctx, { at: 0 }, undefined);

    expect(content(ctx, 't').map(row => row[0])).toEqual([
      { blocks: [], id: 'c0', rowId: 'r0', text: '<b>Old</b>' },
      { blocks: [], id: 'c0', rowId: expect.any(String), text: '<b>Old</b>' },
    ]);
    expect(ctx.edits.filter(edit => edit.op === 'insert')).toEqual([]);
  });

  it('refuses a range past the end and writes nothing', () => {
    const { ctx } = make(1, 2);

    expect(() => handler('duplicateColumns').run(ctx, { at: 1, count: 2 }, undefined)).toThrow(/past the end/);
    expect(() => handler('duplicateRows').run(ctx, { at: 1 }, undefined)).toThrow(/past the end/);
    expect(ctx.edits).toEqual([]);
  });
});

describe('table.clearCells', () => {
  it('clears a range and leaves one empty paragraph per cell', () => {
    const { ctx, id, childIds } = make(1, 2);

    handler('clearCells').run(ctx, { range: { fromRow: 0, fromCol: 0, toRow: 0, toCol: 1 } }, undefined);
    const [row] = content(ctx, id);

    expect(ctx.read(childIds[0])).toBeNull();
    expect(row.map(cell => cell.blocks.length)).toEqual([1, 1]);
    expect(ctx.read(row[0].blocks[0])?.data).toEqual({ text: [] });
  });

  it('drops the legacy text mirror of a cleared cell and keeps it elsewhere', () => {
    const doc = docOf([{
      id: 't', type: 'table',
      data: {
        withHeadings: false, withHeadingColumn: false,
        content: [[{ blocks: [], id: 'c0', rowId: 'r0', text: 'Gone' }, { blocks: [], id: 'c1', rowId: 'r0', text: 'Kept' }]],
      },
    }]);
    const ctx = createFakeCtx(doc, 't');

    handler('clearCells').run(ctx, { range: { fromRow: 0, fromCol: 0, toRow: 0, toCol: 0 } }, undefined);
    const [row] = content(ctx, 't');

    expect(row[0]).not.toHaveProperty('text');
    expect(row[0].blocks).toHaveLength(1);
    expect(row[1]).toEqual({ blocks: [], id: 'c1', rowId: 'r0', text: 'Kept' });
  });

  it('refuses a range outside the table and writes nothing', () => {
    const { ctx } = make(1, 2);

    expect(() => handler('clearCells').run(ctx, { range: { fromRow: 0, fromCol: 0, toRow: 0, toCol: 2 } }, undefined))
      .toThrow(/indices start at 0/);
    expect(ctx.edits).toEqual([]);
  });
});

describe('duplicate and clear declarations', () => {
  it.each(['duplicateRows', 'duplicateColumns'])('%s takes { at, count? }', name => {
    const action = TABLE_ACTIONS.find(candidate => candidate.name === name);

    expect(action?.target).toBe('block');
    expect(validateAgainst(action?.args ?? {}, { at: 0, count: 2 })).toEqual([]);
    expect(validateAgainst(action?.args ?? {}, { at: 0, count: 0 }).length).toBeGreaterThan(0);
    expect(BUILT_IN_TOOL_RUNTIMES.get('table')?.actions[name]).toBe(handler(name));
  });

  it('clearCells takes a required inclusive range', () => {
    const action = TABLE_ACTIONS.find(candidate => candidate.name === 'clearCells');
    const range = { fromRow: 0, fromCol: 0, toRow: 1, toCol: 1 };

    expect(action?.target).toBe('block');
    expect(validateAgainst(action?.args ?? {}, { range })).toEqual([]);
    expect(validateAgainst(action?.args ?? {}, {}).length).toBeGreaterThan(0);
    expect(validateAgainst(action?.args ?? {}, { range: { fromRow: 0 } }).length).toBeGreaterThan(0);
    expect(BUILT_IN_TOOL_RUNTIMES.get('table')?.actions.clearCells).toBe(handler('clearCells'));
  });
});
