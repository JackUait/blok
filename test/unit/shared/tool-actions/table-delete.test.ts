// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { TABLE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/table';
import { TABLE_ACTIONS } from '../../../../src/shared/tool-descriptions/table';
import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

import type { ToolActionImpl } from '../../../../types/tools/tool-description';
import type { FakeCtx } from './fake-ctx';

type Cell = { blocks: string[]; id?: string; rowId?: string };

const handler = (name: string): ToolActionImpl => {
  const found = TABLE_ACTION_HANDLERS[name];

  if (found === undefined) {
    throw new Error(`Missing table handler "${name}".`);
  }

  return found;
};

const make = (rows: number, cols: number, extra: Record<string, unknown> = {}): { ctx: FakeCtx; id: string; childIds: string[] } => {
  const seed = createFakeCtx(docOf([]), undefined, 'table');
  const { id, childIds } = handler('create').run(seed, { rows, cols }, undefined) as { id: string; childIds: string[] };

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

describe('table.deleteRows / deleteColumns', () => {
  it('deletes rows and their cell blocks', () => {
    const { ctx, id, childIds } = make(3, 2);

    handler('deleteRows').run(ctx, { at: 0, count: 2 }, undefined);

    expect(content(ctx, id).map(row => row.map(cell => cell.blocks))).toEqual([[[childIds[4]], [childIds[5]]]]);
    expect(childIds.slice(0, 4).map(child => ctx.read(child))).toEqual([null, null, null, null]);
    expect(ctx.read(childIds[4])).not.toBeNull();
  });

  it('deletes columns, their widths and nested blocks inside the cells', () => {
    const { ctx, id, childIds } = make(2, 3, { colWidths: [100, 200, 300] });

    ctx.insert({ type: 'paragraph', data: { text: [] }, parentId: childIds[1] });
    const nested = ctx.read(childIds[1])?.children[0] ?? '';

    handler('deleteColumns').run(ctx, { at: 1 }, undefined);

    expect(content(ctx, id).map(row => row.map(cell => cell.blocks))).toEqual([
      [[childIds[0]], [childIds[2]]],
      [[childIds[3]], [childIds[5]]],
    ]);
    expect((ctx.read(id)?.data as { colWidths: number[] }).colWidths).toEqual([100, 300]);
    expect(ctx.read(nested)).toBeNull();
    expect(ctx.edits.filter(edit => edit.op === 'remove')).toEqual([
      { op: 'remove', id: nested, withChildren: true },
      { op: 'remove', id: childIds[1], withChildren: true },
      { op: 'remove', id: childIds[4], withChildren: true },
    ]);
  });

  it('skips a dangling cell id: the real context refuses to remove a block that does not exist', () => {
    const { ctx, id } = make(2, 1);
    const rows = content(ctx, id);

    const remove = ctx.remove;

    ctx.update(id, { content: [[{ ...rows[0][0], blocks: ['missing'] }], rows[1]] });
    ctx.remove = (blockId, opts) => {
      if (ctx.read(blockId) === null) {
        throw new FakeFailure('INVALID_ARGS', `Block ${blockId} does not exist.`);
      }
      remove(blockId, opts);
    };
    handler('deleteRows').run(ctx, { at: 0 }, undefined);

    expect(ctx.edits.filter(edit => edit.op === 'remove')).toEqual([]);
    expect(content(ctx, id)).toHaveLength(1);
  });

  it('refuses to delete the last row or column', () => {
    expect(() => handler('deleteRows').run(make(1, 2).ctx, { at: 0 }, undefined)).toThrow(FakeFailure);
    expect(() => handler('deleteColumns').run(make(2, 1).ctx, { at: 0 }, undefined)).toThrow(/at least one column/);
  });

  it('refuses a range past the end and writes nothing', () => {
    const { ctx } = make(2, 2);

    expect(() => handler('deleteColumns').run(ctx, { at: 1, count: 2 }, undefined)).toThrow(/past the end/);
    expect(ctx.edits).toEqual([]);
  });
});

describe('table.deleteRows / deleteColumns declarations', () => {
  it.each(['deleteRows', 'deleteColumns'])('%s targets a block, takes { at, count? } and is wired', name => {
    const action = TABLE_ACTIONS.find(candidate => candidate.name === name);

    expect(action?.target).toBe('block');
    expect(action?.preconditions?.length).toBeGreaterThan(0);
    expect(validateAgainst(action?.args ?? {}, { at: 0, count: 2 })).toEqual([]);
    for (const bad of [{}, { at: -1 }, { at: 0, count: 0 }, { at: 0, extra: 1 }]) {
      expect(validateAgainst(action?.args ?? {}, bad).length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
    expect(BUILT_IN_TOOL_RUNTIMES.get('table')?.actions[name]).toBe(handler(name));
  });
});
