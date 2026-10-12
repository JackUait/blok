// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COMMANDS } from '../../../../src/shared/agent/commands';
import { checkEnvelope } from '../../../../src/shared/agent/envelope';
import { buildBuiltInSnapshot } from '../../../../src/shared/built-in-snapshot';
import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { TABLE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/table';
import { TABLE_ACTIONS } from '../../../../src/shared/tool-descriptions/table';
import { buildAgentContract, buildToolManifest } from '../../../../src/shared/tool-manifest';
import { createFakeCtx, docOf } from './fake-ctx';

import type { ContractWhere } from '../../../../src/shared/tool-manifest';
import type { RichText } from '../../../../types/rich-text';
import type { AgentContract, CommandEntry } from '../../../../types/tool-manifest';
import type { ToolActionContext, ToolActionDeclaration, ToolActionImpl } from '../../../../types/tools/tool-description';
import type { FakeCtx } from './fake-ctx';

type InsertAction = 'insertRows' | 'insertColumns';
type Cell = Record<string, unknown> & { blocks: string[]; id: string; rowId: string };

const actions: InsertAction[] = ['insertRows', 'insertColumns'];
const runtimes: ContractWhere['runtime'][] = ['editor', 'node', 'jint'];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isArray = (value: unknown): value is unknown[] => Array.isArray(value);
const isStringArray = (value: unknown): value is string[] =>
  isArray(value) && value.every(item => typeof item === 'string');
const isCell = (value: unknown): value is Cell =>
  isRecord(value) && isStringArray(value.blocks) &&
  typeof value.id === 'string' && value.id.length > 0 &&
  typeof value.rowId === 'string' && value.rowId.length > 0;
const isRow = (value: unknown): value is Cell[] => isArray(value) && value.every(isCell);

const at = <T>(values: readonly T[], index: number): T => {
  const value = values[index];

  if (value === undefined) {
    throw new Error('Expected a value at this index.');
  }

  return value;
};

const added = (value: unknown): string[] => {
  if (!isRecord(value) || !isStringArray(value.childIds)) {
    throw new Error('Expected the new cell block ids.');
  }

  return value.childIds;
};

const readOf = (ctx: ToolActionContext, id: string): NonNullable<ReturnType<ToolActionContext['read']>> => {
  const block = ctx.read(id);

  if (block === null) {
    throw new Error('Expected the block to exist.');
  }

  return block;
};

const dataOf = (ctx: ToolActionContext, id: string): Record<string, unknown> => {
  const data = readOf(ctx, id).data;

  if (!isRecord(data)) {
    throw new Error('Expected block data.');
  }

  return data;
};

const gridOf = (ctx: ToolActionContext, id: string): Cell[][] => {
  const content = dataOf(ctx, id).content;

  if (!isArray(content) || !content.every(isRow)) {
    throw new Error('Expected cells with row and column ids.');
  }

  return content;
};

const cellAt = (content: Cell[][], row: number, col: number): Cell => at(at(content, row), col);

const handlerOf = (name: InsertAction): ToolActionImpl => {
  const handler = TABLE_ACTION_HANDLERS[name];

  if (handler === undefined) {
    throw new Error(`Missing table handler "${name}".`);
  }

  return handler;
};

const actionOf = (name: InsertAction): ToolActionDeclaration => {
  const action = TABLE_ACTIONS.find(candidate => candidate.name === name);

  if (action === undefined) {
    throw new Error(`Missing table declaration "${name}".`);
  }

  return action;
};

const commandOf = (contract: AgentContract, name: string): CommandEntry => {
  const command = contract.commands.find(candidate => candidate.name === name);

  if (command === undefined) {
    throw new Error(`Missing command "${name}".`);
  }

  return command;
};

const fixture = (extra: Record<string, unknown> = {}, type = 'table'): { ctx: FakeCtx; id: string } => {
  const id = 't';
  const doc = docOf([
    {
      id, type,
      data: {
        withHeadings: true, withHeadingColumn: true, stretched: true, textSize: 'comfortable',
        content: [
          [
            { blocks: ['p00'], id: 'c0', rowId: 'r0', color: 'red', textColor: 'green', placement: 'bottom-right' },
            { blocks: ['p01'], id: 'c1', rowId: 'r0' },
          ],
          [{ blocks: ['p10'], id: 'c0', rowId: 'r1' }, { blocks: ['p11'], id: 'c1', rowId: 'r1' }],
        ],
        ...extra,
      },
    },
    { id: 'p00', type: 'paragraph', data: { text: [{ text: 'A', marks: { bold: true } }] }, parentId: id },
    { id: 'p01', type: 'paragraph', data: { text: [{ text: 'B' }] }, parentId: id },
    { id: 'p10', type: 'paragraph', data: { text: [{ text: 'C' }] }, parentId: id },
    { id: 'p11', type: 'paragraph', data: { text: [{ text: 'D' }] }, parentId: id },
    { id: 'nested', type: 'paragraph', data: { text: [{ text: 'Nested' }] }, parentId: 'p00' },
  ]);

  return { ctx: createFakeCtx(doc, id), id };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('table.insertRows', () => {
  it('preserves old rows and child subtrees while seeding two rows in reading order', () => {
    const { ctx, id } = fixture({ colWidths: [100, 200], initialColWidth: 250 });
    const before = structuredClone(gridOf(ctx, id));
    const children = structuredClone([...ctx.doc.values()].filter(block => block.id !== id));
    const cells: RichText[][] = [
      [[{ text: 'New 1' }], [{ text: 'Marked', marks: { italic: true } }]],
      [[{ text: 'New 2' }]],
    ];
    const childIds = added(handlerOf('insertRows').run(ctx, { at: 1, count: 2, cells }, undefined));
    const content = gridOf(ctx, id);
    const inserted = content.slice(1, 3);

    expect([at(content, 0), at(content, 3)]).toEqual(before);
    expect(inserted.flat().map(cell => cell.blocks)).toEqual(childIds.map(childId => [childId]));
    expect(childIds.map(childId => dataOf(ctx, childId))).toEqual([
      { text: at(at(cells, 0), 0) }, { text: at(at(cells, 0), 1) },
      { text: at(at(cells, 1), 0) }, { text: [] },
    ]);
    expect(content.map(row => row.length)).toEqual([2, 2, 2, 2]);
    expect(new Set(childIds).size).toBe(4);
    expect(inserted.map(row => row.map(cell => cell.id))).toEqual([['c0', 'c1'], ['c0', 'c1']]);
    const rowIds = content.map(row => at(row, 0).rowId);

    expect(new Set(rowIds).size).toBe(4);
    for (const [index, row] of content.entries()) {
      expect(row.map(cell => cell.rowId)).toEqual(Array.from({ length: 2 }, () => at(rowIds, index)));
    }
    expect(children.map(block => readOf(ctx, block.id))).toEqual(children);
    expect(dataOf(ctx, id)).toMatchObject({
      withHeadings: true, withHeadingColumn: true, stretched: true, textSize: 'comfortable',
      colWidths: [100, 200], initialColWidth: 250,
    });
    expect(ctx.edits.filter(edit => edit.op === 'insert').map(edit => edit.id)).toEqual(childIds);
    for (const childId of childIds) {
      expect(readOf(ctx, childId)).toMatchObject({ type: 'paragraph', parentId: id, children: [] });
    }
  });

  it.each([
    { at: 0, slot: 0 }, { at: 2, slot: 2 }, { at: 99, slot: 2 },
  ])('defaults to one row and clamps insertion at $at to $slot', ({ at: index, slot }) => {
    const { ctx, id } = fixture();
    const childIds = added(handlerOf('insertRows').run(ctx, { at: index }, undefined));
    const content = gridOf(ctx, id);

    expect(at(content, slot).map(cell => cell.blocks)).toEqual(childIds.map(childId => [childId]));
    expect(childIds).toHaveLength(2);
    expect(content).toHaveLength(3);
    expect(content.filter((_row, row) => row !== slot).map(row => row.map(cell => cell.blocks)))
      .toEqual([[['p00'], ['p01']], [['p10'], ['p11']]]);
    expect(childIds.map(childId => dataOf(ctx, childId))).toEqual([{ text: [] }, { text: [] }]);
  });

  it('seeds only visible cells when a new row crosses a rowspan', () => {
    const { ctx, id } = fixture({
      content: [
        [{ blocks: ['p00', 'p10'], id: 'c0', rowId: 'r0', rowspan: 2 }, { blocks: ['p01'], id: 'c1', rowId: 'r0' }],
        [{ blocks: [], id: 'c0', rowId: 'r1', mergedInto: [0, 0] }, { blocks: ['p11'], id: 'c1', rowId: 'r1' }],
      ],
    });
    const cells: RichText[][] = [[[{ text: 'Covered' }], [{ text: 'Visible' }]]];
    const childIds = added(handlerOf('insertRows').run(ctx, { at: 1, cells }, undefined));
    const content = gridOf(ctx, id);

    expect(cellAt(content, 1, 0).blocks).toEqual([]);
    expect(cellAt(content, 1, 0).mergedInto).toEqual([0, 0]);
    expect(cellAt(content, 0, 0)).toMatchObject({ blocks: ['p00', 'p10'], rowspan: 3 });
    expect(cellAt(content, 2, 0).mergedInto).toEqual([0, 0]);
    expect(cellAt(content, 1, 1).blocks).toEqual(childIds);
    expect(childIds.map(childId => dataOf(ctx, childId))).toEqual([{ text: [{ text: 'Visible' }] }]);
    expect(ctx.edits.filter(edit => edit.op === 'insert').map(edit => edit.id)).toEqual(childIds);
    expect(ctx.doc.size).toBe(7);
  });
});

describe('table.insertColumns', () => {
  it('maps optional text column by column while preserving old cells, rows and blocks', () => {
    const { ctx, id } = fixture();
    const before = structuredClone(gridOf(ctx, id));
    const children = structuredClone([...ctx.doc.values()].filter(block => block.id !== id));
    const cells: RichText[][] = [
      [[{ text: 'First column, top' }], [{ text: 'First column, bottom' }]],
      [[{ text: 'Second column, top', marks: { bold: true } }]],
    ];
    const childIds = added(handlerOf('insertColumns').run(ctx, { at: 1, count: 2, cells }, undefined));
    const content = gridOf(ctx, id);

    expect(childIds.map(childId => dataOf(ctx, childId))).toEqual([
      { text: at(at(cells, 0), 0) }, { text: at(at(cells, 0), 1) },
      { text: at(at(cells, 1), 0) }, { text: [] },
    ]);
    expect(content.map(row => [at(row, 0), at(row, 3)])).toEqual(before);
    expect([cellAt(content, 0, 1), cellAt(content, 1, 1), cellAt(content, 0, 2), cellAt(content, 1, 2)]
      .map(cell => cell.blocks)).toEqual(childIds.map(childId => [childId]));
    expect(content.map(row => row.length)).toEqual([4, 4]);
    const columnIds = at(content, 0).map(cell => cell.id);

    expect(at(content, 1).map(cell => cell.id)).toEqual(columnIds);
    expect(new Set(columnIds).size).toBe(4);
    expect(at(content, 0).map(cell => cell.rowId)).toEqual(['r0', 'r0', 'r0', 'r0']);
    expect(at(content, 1).map(cell => cell.rowId)).toEqual(['r1', 'r1', 'r1', 'r1']);
    expect(children.map(block => readOf(ctx, block.id))).toEqual(children);
    expect(dataOf(ctx, id)).toMatchObject({
      withHeadings: true, withHeadingColumn: true, stretched: true, textSize: 'comfortable',
    });
    expect(new Set(childIds).size).toBe(4);
    expect(ctx.edits.filter(edit => edit.op === 'insert').map(edit => edit.id)).toEqual(childIds);
    for (const childId of childIds) {
      expect(readOf(ctx, childId)).toMatchObject({ type: 'paragraph', parentId: id, children: [] });
    }
  });

  it.each([
    { at: 0, slot: 0 }, { at: 2, slot: 2 }, { at: 99, slot: 2 },
  ])('defaults to one column and clamps insertion at $at to $slot', ({ at: index, slot }) => {
    const { ctx, id } = fixture();
    const childIds = added(handlerOf('insertColumns').run(ctx, { at: index }, undefined));
    const content = gridOf(ctx, id);

    expect(content.map(row => at(row, slot).blocks)).toEqual(childIds.map(childId => [childId]));
    expect(childIds).toHaveLength(2);
    expect(content.map(row => row.length)).toEqual([3, 3]);
    expect(content.map(row => row.filter((_cell, col) => col !== slot).map(cell => cell.blocks)))
      .toEqual([[['p00'], ['p01']], [['p10'], ['p11']]]);
    expect(childIds.map(childId => dataOf(ctx, childId))).toEqual([{ text: [] }, { text: [] }]);
  });

  it.each([
    { label: 'half current average', extra: { colWidths: [100, 200] }, at: 2, count: 1, expected: [100, 200, 75] },
    { label: 'fractional average', extra: { colWidths: [100, 201] }, at: 1, count: 1, expected: [100, 75.25, 201] },
    { label: 'original creation width', extra: { colWidths: [100, 200], initialColWidth: 251 }, at: 1, count: 1, expected: [100, 125.5, 200] },
    { label: 'evolving average', extra: { colWidths: [100, 200] }, at: 1, count: 2, expected: [100, 75, 62.5, 200] },
    { label: 'fixed creation width for a batch', extra: { colWidths: [100, 200], initialColWidth: 250 }, at: 1, count: 2, expected: [100, 125, 125, 200] },
  ])('uses $label for explicit column widths', ({ extra, at: index, count, expected }) => {
    const { ctx, id } = fixture(extra);
    const childIds = added(handlerOf('insertColumns').run(ctx, { at: index, count }, undefined));

    expect(dataOf(ctx, id).colWidths).toEqual(expected);
    expect(gridOf(ctx, id).map(row => row.length)).toEqual([2 + count, 2 + count]);
    expect(childIds).toHaveLength(2 * count);
    if ('initialColWidth' in extra) {
      expect(dataOf(ctx, id).initialColWidth).toBe(extra.initialColWidth);
    }
  });

  it.each([{}, { initialColWidth: 250 }])('does not write widths for a fit-to-page table %j', extra => {
    const { ctx, id } = fixture(extra);

    handlerOf('insertColumns').run(ctx, { at: 0, count: 2 }, undefined);

    expect(dataOf(ctx, id)).not.toHaveProperty('colWidths');
    expect(ctx.edits.some(edit => edit.op === 'update' && Object.hasOwn(edit.patch, 'colWidths'))).toBe(false);
    expect(gridOf(ctx, id).map(row => row.length)).toEqual([4, 4]);
    if ('initialColWidth' in extra) {
      expect(dataOf(ctx, id).initialColWidth).toBe(extra.initialColWidth);
    }
  });

  it('seeds only visible cells when a new column crosses a colspan', () => {
    const { ctx, id } = fixture({
      content: [
        [{ blocks: ['p00', 'p01'], id: 'c0', rowId: 'r0', colspan: 2 }, { blocks: [], id: 'c1', rowId: 'r0', mergedInto: [0, 0] }],
        [{ blocks: ['p10'], id: 'c0', rowId: 'r1' }, { blocks: ['p11'], id: 'c1', rowId: 'r1' }],
      ],
    });
    const cells: RichText[][] = [[[{ text: 'Covered' }], [{ text: 'Visible' }]]];
    const childIds = added(handlerOf('insertColumns').run(ctx, { at: 1, cells }, undefined));
    const content = gridOf(ctx, id);

    expect(cellAt(content, 0, 1).blocks).toEqual([]);
    expect(cellAt(content, 0, 1).mergedInto).toEqual([0, 0]);
    expect(cellAt(content, 0, 0)).toMatchObject({ blocks: ['p00', 'p01'], colspan: 3 });
    expect(cellAt(content, 0, 2).mergedInto).toEqual([0, 0]);
    expect(cellAt(content, 1, 1).blocks).toEqual(childIds);
    expect(childIds.map(childId => dataOf(ctx, childId))).toEqual([{ text: [{ text: 'Visible' }] }]);
    expect(ctx.edits.filter(edit => edit.op === 'insert').map(edit => edit.id)).toEqual(childIds);
    expect(ctx.doc.size).toBe(7);
  });
});

describe('table insertion declarations, aliases and controls', () => {
  it.each(actions)('%s works under an aliased table registry key', name => {
    const { ctx, id } = fixture({}, 'grid');
    const childIds = added(handlerOf(name).run(ctx, { at: 0 }, undefined));

    expect(readOf(ctx, id).type).toBe('grid');
    expect(childIds).toHaveLength(2);
    expect(childIds.map(childId => readOf(ctx, childId).parentId)).toEqual([id, id]);
  });

  it.each(actions)('%s requires a target block without recording writes', name => {
    const ctx = createFakeCtx(docOf([]), undefined, 'table');
    let failure: unknown;

    try {
      handlerOf(name).run(ctx, { at: 0 }, undefined);
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({ code: 'INVALID_ARGS' });
    expect(ctx.edits).toEqual([]);
  });

  it.each(actions)('%s declares block targeting, count defaults and no mirrors', name => {
    const action = actionOf(name);

    expect(action.target).toBe('block');
    expect(action.args).toMatchObject({
      required: ['at'], additionalProperties: false,
      properties: { at: { type: 'integer', minimum: 0 }, count: { type: 'integer', minimum: 1, default: 1 } },
    });
    expect(action.mirrors ?? []).toEqual([]);
    expect(BUILT_IN_TOOL_RUNTIMES.get('table')?.actions[name]).toBe(handlerOf(name));
  });

  it.each(actions)('%s declares the returned paragraph id list', name => {
    const schema = actionOf(name).result;

    if (schema === undefined) {
      throw new Error('Expected the insertion result schema.');
    }

    expect(validateAgainst(schema, { childIds: [1] }).length).toBeGreaterThan(0);
    expect(validateAgainst(schema, { childIds: ['cell'] })).toEqual([]);
  });

  it.each(actions)('%s validates optional cell rich text and rejects bad indices and counts', name => {
    const schema = actionOf(name).args;

    for (const args of [
      {}, { at: -1 }, { at: 0.5 }, { at: '0' }, { at: 0, count: 0 },
      { at: 0, count: -1 }, { at: 0, count: 1.5 }, { at: 0, count: '1' },
      { at: 0, cells: 'text' }, { at: 0, cells: [1] }, { at: 0, cells: [[1]] },
      { at: 0, cells: [[[{ text: 1 }]]] }, { at: 0, unknown: true },
    ]) {
      expect(validateAgainst(schema, args).length, JSON.stringify(args)).toBeGreaterThan(0);
    }
    expect(validateAgainst(schema, { at: 0 })).toEqual([]);
    expect(validateAgainst(schema, { at: 99, count: 2, cells: [[[{ text: 'A', marks: { bold: true } }]], []] })).toEqual([]);
    expect(validateAgainst(schema, { at: 0, cells: [['<b>HTML input</b>']] })).toEqual([]);
  });

  it.each(runtimes)('publishes actual insertion handlers and core-added target ids for %s', runtime => {
    const snapshot = buildBuiltInSnapshot({ blokVersion: 'table-actions-test' });
    const contract = buildAgentContract(buildToolManifest(snapshot), COMMANDS, { runtime, services: [] });

    for (const name of actions) {
      const command = commandOf(contract, `table.${name}`);

      expect(command).toMatchObject({ available: true, source: { tool: 'table', target: 'block' }, runtime: 'any' });
      expect(snapshot.blocks.find(block => block.name === 'table')?.handlers).toContain(name);
      expect(validateAgainst(command.args, { at: 0 }).length).toBeGreaterThan(0);
      expect(validateAgainst(command.args, { id: 't', at: 0 })).toEqual([]);
      expect(checkEnvelope({ commands: [{ name: `table.${name}`, args: { id: 't', at: 0 } }] },
        new Map(contract.commands.map(entry => [entry.name, entry])), validateAgainst).writes).toBe(true);
    }
  });

  it.each(actions)('hides %s through the real manifest override without hiding the table', name => {
    const snapshot = buildBuiltInSnapshot({ blokVersion: 'table-actions-test' });
    const contract = buildAgentContract(buildToolManifest(snapshot, { table: { hiddenActions: [name] } }),
      COMMANDS, { runtime: 'editor', services: [] });

    expect(contract.commands.some(command => command.name === `table.${name}`)).toBe(false);
    expect(contract.manifest.blocks.some(block => block.name === 'table')).toBe(true);
    for (const sibling of actions.filter(action => action !== name)) {
      expect(commandOf(contract, `table.${sibling}`).available).toBe(true);
    }
    expect(commandOf(contract, 'table.create').available).toBe(true);
  });
});
