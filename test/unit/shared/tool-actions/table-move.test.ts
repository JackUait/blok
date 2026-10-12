// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { TABLE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/table';
import { TABLE_ACTIONS } from '../../../../src/shared/tool-descriptions/table';
import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

import type { ToolActionImpl } from '../../../../types/tools/tool-description';
import type { FakeCtx } from './fake-ctx';

type Cell = { blocks: string[] };

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

describe('table.moveRow / moveColumn', () => {
  it('moves a row and keeps its cells', () => {
    const { ctx, id, childIds } = make(3, 1);

    handler('moveRow').run(ctx, { from: 0, to: 2 }, undefined);

    expect(content(ctx, id).map(row => row[0].blocks[0])).toEqual([childIds[1], childIds[2], childIds[0]]);
    expect(ctx.edits.every(edit => edit.op === 'update')).toBe(true);
  });

  it('moves a column together with its width', () => {
    const { ctx, id, childIds } = make(1, 3, { colWidths: [100, 200, 300] });

    handler('moveColumn').run(ctx, { from: 2, to: 0 }, undefined);

    expect(content(ctx, id)[0].map(cell => cell.blocks[0])).toEqual([childIds[2], childIds[0], childIds[1]]);
    expect((ctx.read(id)?.data as { colWidths: number[] }).colWidths).toEqual([300, 100, 200]);
  });

  it('refuses an index outside the table', () => {
    expect(() => handler('moveColumn').run(make(1, 2).ctx, { from: 0, to: 2 }, undefined)).toThrow(/indices start at 0/);
  });

  it('refuses a move that would tear a merge', () => {
    const { ctx, id } = make(3, 2);

    handler('mergeCells').run(ctx, { range: { fromRow: 0, fromCol: 0, toRow: 1, toCol: 0 } }, undefined);
    const merged = createFakeCtx(ctx.doc, id);

    expect(() => handler('moveRow').run(merged, { from: 0, to: 2 }, undefined)).toThrow(FakeFailure);
    expect(() => handler('moveRow').run(merged, { from: 2, to: 1 }, undefined)).toThrow(/split a merged cell/);
    expect(merged.edits).toEqual([]);
  });
});

describe('table.moveRow / moveColumn declarations', () => {
  it.each(['moveRow', 'moveColumn'])('%s targets a block, takes { from, to } and is wired', name => {
    const action = TABLE_ACTIONS.find(candidate => candidate.name === name);

    expect(action?.target).toBe('block');
    expect(validateAgainst(action?.args ?? {}, { from: 0, to: 1 })).toEqual([]);
    for (const bad of [{ from: 0 }, { to: 0 }, { from: -1, to: 0 }, { from: 0, to: 1, at: 0 }]) {
      expect(validateAgainst(action?.args ?? {}, bad).length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
    expect(BUILT_IN_TOOL_RUNTIMES.get('table')?.actions[name]).toBe(handler(name));
  });
});
