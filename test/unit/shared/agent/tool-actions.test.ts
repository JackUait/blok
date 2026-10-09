// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentFailure } from '../../../../src/shared/agent/errors';
import { planBatch } from '../../../../src/shared/agent/planner';
import { PREPARE_PENDING } from '../../../../src/shared/agent/plan-state';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';
import { isRichText } from '../../../../src/shared/rich-text/guards';
import { coreCommandMap, plannerContext, planOn, stubPorts, TOOLS, tool } from './fixtures';

import type { PlannerCommand, PlannerTool } from '../../../../src/shared/agent/types';
import type { AgentCommand, OutputData, RichText } from '../../../../types';
import type { ToolActionContext, ToolActionImpl } from '../../../../types/tools/tool-description';

const doc: OutputData = { blocks: [
  { id: 'tbl', type: 'table', data: { content: [[{ blocks: ['cell'] }]] }, content: ['cell'] },
  { id: 'cell', type: 'paragraph', data: { text: [{ text: 'Cell' }] }, parent: 'tbl' },
  { id: 'p', type: 'paragraph', data: { text: [{ text: 'Before' }], old: 'remove', options: { first: 1, second: 2 } }, lastEditedBy: 'human', lastEditedAt: 8 },
  { id: 'tg', type: 'toggle', data: { text: [] }, content: ['leaf'] },
  { id: 'leaf', type: 'paragraph', data: { text: [] }, parent: 'tg' },
  { id: 'h', type: 'header', data: { text: [], level: 5, old: 'remove' } },
  { id: 'dv', type: 'divider', data: {} },
] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

const recordOf = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error('Expected a record');
  }

  return value;
};

const blockOf = (ctx: ToolActionContext): NonNullable<ToolActionContext['block']> => {
  const block = ctx.block;

  if (block === undefined) {
    return ctx.fail('INVALID_ARGS', 'A block is required.');
  }

  return block;
};

const readOf = (ctx: ToolActionContext, id: string): NonNullable<ReturnType<ToolActionContext['read']>> => {
  const block = ctx.read(id);

  if (block === null) {
    return ctx.fail('INVALID_ARGS', 'The requested block is missing.');
  }

  return block;
};

const registered = (name: string): PlannerTool => {
  const found = TOOLS.get(name);

  if (found === undefined) {
    throw new Error('Missing fixture tool');
  }

  return found;
};

const withActions = (
  key: string,
  actions: Readonly<Record<string, ToolActionImpl>>,
  targets: Readonly<Record<string, 'block' | 'create'>> = {},
  entry: Partial<PlannerTool['entry']> = {},
  runtime: Partial<PlannerTool['runtime']> = {}
): { tools: Map<string, PlannerTool>; commands: Map<string, PlannerCommand> } => {
  const tools = new Map(TOOLS);
  const commands = coreCommandMap();

  tools.set(key, tool(key, { ...TOOLS.get(key)?.entry, ...entry, name: key }, { ...runtime, actions }));
  for (const action of new Set([...Object.keys(actions), ...Object.keys(targets)])) {
    const name = key + '.' + action;

    commands.set(name, {
      name, args: { type: 'object' }, readOnly: false, available: true,
      source: { tool: key, target: Object.hasOwn(targets, action) ? targets[action] ?? 'block' : 'block' },
    });
  }

  return { tools, commands };
};

const failOf = (run: () => unknown): AgentFailure['error'] => {
  try {
    run();
  } catch (error) {
    if (error instanceof AgentFailure) {
      return error.error;
    }
    throw error;
  }
  throw new Error('Expected an AgentFailure');
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tool action dispatch through the public planner', () => {
  it('passes flat args unchanged and selects the prepared value by command index', () => {
    const args = { id: 'p', parentId: 'tg', position: { before: 'leaf' }, label: 'Flat', nested: { keep: true } };
    const prepared = { token: 'ready' };
    const run: ToolActionImpl['run'] = (ctx: ToolActionContext, input: unknown, value: unknown) => ({
      sameArgs: input === args,
      samePrepared: value === prepared,
      args: input,
      block: ctx.block,
      tool: ctx.tool,
    });
    const setup = withActions('paragraph', { inspect: { run } });
    const { plan } = planOn(doc, [
      { name: 'block.update', args: { id: 'h', data: { level: 3 } } },
      { name: 'paragraph.inspect', args },
    ], { ...setup, prepared: new Map<number, unknown>([[0, 'wrong-slot'], [1, prepared]]) });

    expect(plan.results[1]).toEqual({
      sameArgs: true, samePrepared: true, args,
      block: {
        id: 'p', type: 'paragraph',
        data: { text: [{ text: 'Before' }], old: 'remove', options: { first: 1, second: 2 } },
        children: [],
      },
      tool: 'paragraph',
    });
    expect(plan.edits).toEqual([{ op: 'setData', id: 'h', patch: { level: 3 } }]);
  });

  it('passes undefined when no prepared value exists and does not call prepare in the planner', () => {
    const prepare = vi.fn(() => Promise.resolve('must-not-run'));
    const setup = withActions('paragraph', {
      inspect: { prepare, run: (_ctx: ToolActionContext, _args: unknown, prepared: unknown) => ({ prepared }) },
    });
    const { plan } = planOn(doc, [{ name: 'paragraph.inspect', args: { id: 'p' } }], setup);

    expect(plan.results).toEqual([{ prepared: undefined }]);
    expect(plan.edits).toEqual([]);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('returns the handler result without requiring an id on a non-create action', () => {
    const result = { rowIds: ['cell'], count: 1 };
    const setup = withActions('table', { inspect: { run: () => result } });
    const { plan } = planOn(doc, [{ name: 'table.inspect', args: { id: 'tbl' } }], setup);

    expect(plan.results[0]).toBe(result);
    expect(plan.edits).toEqual([]);
  });

  it('gives a create action the aliased registry key and no target block', () => {
    const setup = withActions('grid', {
      create: { run: (ctx: ToolActionContext) => ({
        id: ctx.insert({ type: ctx.tool, data: { content: [] } }),
        childIds: [],
        hasBlock: ctx.block !== undefined,
        tool: ctx.tool,
      }) },
    }, { create: 'create' }, registered('table').entry);
    const { plan, draft } = planOn(doc, [
      { name: 'grid.create', args: {}, ref: 'made' },
      { name: 'block.update', args: { id: '$made', data: { label: 'Created' } } },
    ], setup);

    expect(draft.get('n1')?.type).toBe('grid');
    expect(plan.results).toEqual([
      { id: 'n1', childIds: [], hasBlock: false, tool: 'grid' },
      { id: 'n1' },
    ]);
    expect(plan.refs).toEqual({ made: 'n1' });
    expect(draft.get('n1')?.data).toEqual({ content: [], label: 'Created' });
    expect(plan.changed).toEqual({ created: ['n1'], updated: [], moved: [], removed: [] });
  });

  it('resolves a block target ref without replacing the ref in the handler args', () => {
    const setup = withActions('paragraph', {
      inspect: { run: (ctx: ToolActionContext, args: unknown) => ({ target: blockOf(ctx).id, args }) },
    });
    const { plan } = planOn(doc, [
      { name: 'block.insert', args: { type: 'paragraph', data: { text: 'New' } }, ref: 'made' },
      { name: 'paragraph.inspect', args: { id: '$made', label: 'Unchanged' } },
    ], setup);

    expect(plan.results[1]).toEqual({ target: 'n1', args: { id: '$made', label: 'Unchanged' } });
  });

  it('rejects a wrong target type before calling the handler', () => {
    const run = vi.fn(() => { throw new Error('handler ran'); });
    const setup = withActions('table', { inspect: { run } });
    const error = failOf(() => planOn(doc, [{ name: 'table.inspect', args: { id: 'p' } }], setup));

    expect(error).toMatchObject({ code: 'INVALID_ARGS', commandIndex: 0, path: '/commands/0/args/id' });
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    { args: {}, code: 'INVALID_ARGS' },
    { args: { id: 'gone' }, code: 'BLOCK_NOT_FOUND' },
  ])('rejects an invalid block target with $code', ({ args, code }) => {
    const run = vi.fn(() => { throw new Error('handler ran'); });
    const setup = withActions('table', { inspect: { run } });
    const error = failOf(() => planOn(doc, [{ name: 'table.inspect', args }], setup));

    expect(error).toMatchObject({ code, commandIndex: 0, path: '/commands/0/args/id' });
    expect(run).not.toHaveBeenCalled();
  });

  it('reports a declared action without a runtime implementation', () => {
    const setup = withActions('table', {}, { missing: 'block' });
    const error = failOf(() => planOn(doc, [{ name: 'table.missing', args: { id: 'tbl' } }], setup));

    expect(error).toMatchObject({
      code: 'COMMAND_UNAVAILABLE', commandIndex: 0, path: '/commands/0/args',
      details: { reason: 'runtime' }, retryable: false,
    });
  });

  it('does not execute a runtime handler whose command is absent from the contract', () => {
    const run = vi.fn(() => 'should-not-run');
    const setup = withActions('table', { hidden: { run } });

    setup.commands.delete('table.hidden');
    expect(failOf(() => planOn(doc, [{ name: 'table.hidden', args: { id: 'tbl' } }], setup)))
      .toMatchObject({ code: 'UNKNOWN_COMMAND', commandIndex: 0 });
    expect(run).not.toHaveBeenCalled();
  });

  it.each(['constructor', 'toString'])('does not treat inherited %s as a runtime handler', name => {
    const setup = withActions('paragraph', {}, { [name]: 'block' });

    expect(failOf(() => planOn(doc, [{ name: `paragraph.${name}`, args: { id: 'p' } }], setup)))
      .toMatchObject({ code: 'COMMAND_UNAVAILABLE', details: { reason: 'runtime' } });
  });

  it.each(['constructor', 'toString'])('dispatches an own runtime handler named %s', name => {
    const actions: Readonly<Record<string, ToolActionImpl>> = {
      [name]: { run: () => ({ handled: name }) },
    };
    const setup = withActions('paragraph', actions);
    const { plan } = planOn(doc, [{ name: `paragraph.${name}`, args: { id: 'p' } }], setup);

    expect(plan.results).toEqual([{ handled: name }]);
  });

  it('leaves existing core dispatch intact', () => {
    const setup = withActions('paragraph', { update: { run: () => { throw new Error('wrong dispatch'); } } });
    const { plan, draft } = planOn(doc, [{ name: 'block.update', args: { id: 'p', data: { text: 'Core' } } }], setup);

    expect(draft.get('p')?.data.text).toEqual([{ text: 'Core' }]);
    expect(plan.results).toEqual([{ id: 'p' }]);
    expect(plan.edits).toEqual([{ op: 'setRichText', id: 'p', field: 'text', value: [{ text: 'Core' }] }]);
  });
});

describe('tool action pre-planning and failures', () => {
  it.each([
    { name: 'table.change', args: { id: 'tbl' }, target: 'block' },
    { name: 'table.create', args: {}, target: 'create' },
  ] satisfies Array<{ name: AgentCommand['name']; args: Record<string, unknown>; target: 'block' | 'create' }>)
  ('does not run $name while preparation is pending', ({ name, args, target }) => {
    const run = vi.fn((ctx: ToolActionContext) => ctx.insert({ type: 'paragraph', data: { text: 'Should not exist' } }));
    const action = target === 'block' ? 'change' : 'create';
    const setup = withActions('table', { [action]: { run } }, { [action]: target });
    const { plan, draft } = planOn(doc, [{ name, args }], {
      ...setup, prepared: new Map<number, unknown>([[0, PREPARE_PENDING]]),
    });

    expect(plan.edits).toEqual([]);
    expect(plan.results).toEqual([{}]);
    expect(draft.toOutput()).toEqual(doc);
    expect(run).not.toHaveBeenCalled();
  });

  it('still checks a pending action block target', () => {
    const setup = withActions('table', { inspect: { run: () => ({}) } });

    expect(failOf(() => planOn(doc, [{ name: 'table.inspect', args: { id: 'p' } }], {
      ...setup, prepared: new Map<number, unknown>([[0, PREPARE_PENDING]]),
    }))).toMatchObject({ code: 'INVALID_ARGS', commandIndex: 0, path: '/commands/0/args/id' });
  });

  it.each(['PRECONDITION_FAILED', 'INVALID_ARGS'] satisfies Array<'PRECONDITION_FAILED' | 'INVALID_ARGS'>)
  ('preserves ctx.fail %s with the correct batch location', code => {
    const setup = withActions('table', {
      guarded: { run: (ctx: ToolActionContext) => ctx.fail(code, 'Table has merged cells.') },
    });
    const error = failOf(() => planOn(doc, [
      { name: 'block.update', args: { id: 'h', data: { level: 3 } } },
      { name: 'table.guarded', args: { id: 'tbl' } },
    ], setup));

    expect(error).toMatchObject({
      code, message: 'Table has merged cells.', retryable: false,
      commandIndex: 1, path: '/commands/1/args',
    });
  });

  it.each([
    { value: new Error('boom'), message: 'boom' },
    { value: 'string failure', message: 'string failure' },
    { value: null, message: 'null' },
  ])('wraps an unexpected handler throw containing $message', ({ value, message }) => {
    const setup = withActions('table', { broken: { run: () => { throw value; } } });
    const error = failOf(() => planOn(doc, [
      { name: 'block.update', args: { id: 'h', data: { level: 3 } } },
      { name: 'table.broken', args: { id: 'tbl' } },
    ], setup));

    expect(error).toMatchObject({
      code: 'TOOL_ACTION_FAILED', commandIndex: 1, path: '/commands/1/args', retryable: false,
    });
    expect(error.message).toContain('table.broken');
    expect(error.message).toContain(message);
  });

  it('preserves a typed failure from rich-text helpers', () => {
    const setup = withActions('paragraph', {
      brokenRange: { run: (ctx: ToolActionContext) => ctx.richText.resolve([{ text: 'X' }], { start: 0, end: 2 }) },
    });

    expect(failOf(() => planOn(doc, [{ name: 'paragraph.brokenRange', args: { id: 'p' } }], setup)))
      .toMatchObject({
        code: 'RANGE_OUT_OF_BOUNDS', commandIndex: 0, path: '/commands/0/args', details: { length: 1 },
      });
  });

  it('does not mutate the source snapshot when a handler writes and then fails', () => {
    const snapshot = DocSnapshot.fromOutput(doc);
    const before = snapshot.toOutput();
    const setup = withActions('paragraph', {
      broken: { run: (ctx: ToolActionContext) => {
        ctx.update(blockOf(ctx).id, { old: null, text: 'Uncommitted' });
        ctx.insert({ type: 'paragraph', data: { text: 'Uncommitted child' } });

        return ctx.fail('PRECONDITION_FAILED', 'Abort this action.');
      } },
    });
    const error = failOf(() => planBatch({
      snapshot, batch: { commands: [{ name: 'paragraph.broken', args: { id: 'p' } }] },
      ctx: plannerContext(setup), stamp: { actorId: 'agent', at: 1 }, warnings: [],
    }));

    expect(error).toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(snapshot.toOutput()).toEqual(before);
  });
});

describe('recording context reads and inserts', () => {
  it('reads complete block views and returns null for a missing id without recording a write', () => {
    const setup = withActions('table', {
      inspect: { run: (ctx: ToolActionContext) => ({
        block: ctx.block,
        table: ctx.read('tbl'),
        child: ctx.read('cell'),
        missing: ctx.read('gone'),
      }) },
    });
    const { plan } = planOn(doc, [{ name: 'table.inspect', args: { id: 'tbl' } }], setup);

    expect(plan.results).toEqual([{
      block: { id: 'tbl', type: 'table', data: { content: [[{ blocks: ['cell'] }]] }, children: ['cell'] },
      table: { id: 'tbl', type: 'table', data: { content: [[{ blocks: ['cell'] }]] }, parentId: null, children: ['cell'] },
      child: { id: 'cell', type: 'paragraph', data: { text: [{ text: 'Cell' }] }, parentId: 'tbl', children: [] },
      missing: null,
    }]);
    expect(plan.edits).toEqual([]);
    expect(plan.changed).toEqual({ created: [], updated: [], moved: [], removed: [] });
    expect([...plan.touched]).toEqual([]);
  });

  it('records a table child insertion and guarded update with immediate read-your-writes', () => {
    const setup = withActions('table', {
      insertRows: { run: (ctx: ToolActionContext) => {
        const block = blockOf(ctx);
        const rows = block.data.content;

        if (!isArray(rows)) {
          return ctx.fail('INVALID_ARGS', 'Table content must be an array.');
        }
        const id = ctx.insert({ type: 'paragraph', data: { text: 'New cell' }, parentId: block.id, position: 'end' });
        const children = [...readOf(ctx, block.id).children];

        ctx.update(block.id, { content: [...rows, [{ blocks: [id] }]] });

        return { rowIds: [id], children, content: recordOf(readOf(ctx, block.id).data).content };
      } },
    });
    const { plan, draft } = planOn(doc, [{ name: 'table.insertRows', args: { id: 'tbl' } }], setup);

    expect(plan.results).toEqual([{
      rowIds: ['n1'], children: ['cell', 'n1'],
      content: [[{ blocks: ['cell'] }], [{ blocks: ['n1'] }]],
    }]);
    expect(plan.edits).toEqual([
      { op: 'insert', block: { id: 'n1', type: 'paragraph', data: { text: [{ text: 'New cell' }] }, children: [] }, parentId: 'tbl', afterId: 'cell' },
      { op: 'setData', id: 'tbl', patch: { content: [[{ blocks: ['cell'] }], [{ blocks: ['n1'] }]] } },
    ]);
    expect(draft.cellOf('n1')).toEqual({ tableId: 'tbl', row: 1, col: 0 });
    expect(plan.changed).toEqual({ created: ['n1'], updated: ['tbl'], moved: [], removed: [] });
    expect([...plan.touched]).toEqual(['n1', 'tbl']);
    expect(draft.get('n1')?.rest).toEqual({ lastEditedBy: 'agent', lastEditedAt: 1 });
  });

  const positions: Array<{
    label: string; input: Parameters<ToolActionContext['insert']>[0]; parent: string | null; after: string | null; order: string[];
  }> = [
    { label: 'omitted position at root', input: { type: 'paragraph' }, parent: null, after: 'dv', order: ['tbl', 'p', 'tg', 'h', 'dv', 'n1'] },
    { label: 'root start', input: { type: 'paragraph', parentId: null, position: 'start' }, parent: null, after: null, order: ['n1', 'tbl', 'p', 'tg', 'h', 'dv'] },
    { label: 'omitted position in a parent', input: { type: 'paragraph', parentId: 'tg' }, parent: 'tg', after: 'leaf', order: ['leaf', 'n1'] },
    { label: 'before a child without parentId', input: { type: 'paragraph', position: { before: 'leaf' } }, parent: 'tg', after: null, order: ['n1', 'leaf'] },
    { label: 'after a child without parentId', input: { type: 'paragraph', position: { after: 'leaf' } }, parent: 'tg', after: 'leaf', order: ['leaf', 'n1'] },
  ];

  it.each(positions)('places a context insert at $label', ({ input, parent, after, order }) => {
    const setup = withActions('paragraph', { add: { run: (ctx: ToolActionContext) => ({ id: ctx.insert(input) }) } });
    const { plan, draft } = planOn(doc, [{ name: 'paragraph.add', args: { id: 'p' } }], setup);

    expect(draft.childrenOf(parent)).toEqual(order);
    expect(plan.edits).toEqual([{
      op: 'insert', block: { id: 'n1', type: 'paragraph', data: {}, children: [] }, parentId: parent, afterId: after,
    }]);
    expect(plan.results).toEqual([{ id: 'n1' }]);
  });

  it('preserves nested child ids, tunes, data and order through the context insert shape', () => {
    const setup = withActions('paragraph', {
      add: { run: (ctx: ToolActionContext) => {
        const id = ctx.insert({
          type: 'toggle', data: { text: 'Outer' }, children: [
            { id: 'child-a', type: 'paragraph', data: { text: 'A' }, tunes: { color: 'gray' } },
            { id: 'child-b', type: 'toggle', data: { text: 'B' }, children: [{ id: 'grandchild', type: 'paragraph', data: { text: 'G' } }] },
          ],
        });

        return { id, view: ctx.read(id), grandchild: ctx.read('grandchild') };
      } },
    });
    const { plan, draft } = planOn(doc, [{ name: 'paragraph.add', args: { id: 'p' } }], setup);

    expect(draft.childrenOf('n1')).toEqual(['child-a', 'child-b']);
    expect(draft.childrenOf('child-b')).toEqual(['grandchild']);
    expect(draft.get('child-a')?.tunes).toEqual({ color: 'gray' });
    expect(plan.results).toEqual([{
      id: 'n1',
      view: { id: 'n1', type: 'toggle', data: { text: [{ text: 'Outer' }] }, parentId: null, children: ['child-a', 'child-b'] },
      grandchild: { id: 'grandchild', type: 'paragraph', data: { text: [{ text: 'G' }] }, parentId: 'child-b', children: [] },
    }]);
    expect(plan.changed.created).toEqual(['n1', 'child-a', 'child-b', 'grandchild']);
    expect(plan.edits).toEqual([{
      op: 'insert', parentId: null, afterId: 'dv',
      block: {
        id: 'n1', type: 'toggle', data: { text: [{ text: 'Outer' }] },
        children: [
          { id: 'child-a', type: 'paragraph', data: { text: [{ text: 'A' }] }, tunes: { color: 'gray' }, children: [] },
          { id: 'child-b', type: 'toggle', data: { text: [{ text: 'B' }] }, children: [{ id: 'grandchild', type: 'paragraph', data: { text: [{ text: 'G' }] }, children: [] }] },
        ],
      },
    }]);
  });

  it.each([
    { label: 'omitted', input: { type: 'column_list' }, ids: ['n2', 'n3'] },
    { label: 'empty', input: { type: 'column_list', children: [] }, ids: [] },
    { label: 'explicit', input: { type: 'column_list', children: [{ type: 'column' }] }, ids: ['n2'] },
  ] satisfies Array<{ label: string; input: Parameters<ToolActionContext['insert']>[0]; ids: string[] }>)
  ('uses $label child specifications for context inserts', ({ input, ids }) => {
    const setup = withActions('paragraph', { add: { run: (ctx: ToolActionContext) => ({ id: ctx.insert(input) }) } });
    const { plan, draft } = planOn(doc, [{ name: 'paragraph.add', args: { id: 'p' } }], setup);

    expect(draft.childrenOf('n1')).toEqual(ids);
    expect(plan.changed.created).toEqual(['n1', ...ids]);
  });

  it('rejects an unknown tool inside a context insert', () => {
    const setup = withActions('paragraph', { add: { run: (ctx: ToolActionContext) => ctx.insert({ type: 'unknown' }) } });

    expect(failOf(() => planOn(doc, [{ name: 'paragraph.add', args: { id: 'p' } }], setup)))
      .toMatchObject({ code: 'UNKNOWN_TOOL', commandIndex: 0, path: '/commands/0/args/type' });
  });

  it('uses newId for tool metadata without creating a phantom block', () => {
    const setup = withActions('table', {
      add: { run: (ctx: ToolActionContext) => {
        const rowId = ctx.newId();
        const id = ctx.insert({ type: 'paragraph', data: { text: [] }, parentId: blockOf(ctx).id });

        ctx.update(blockOf(ctx).id, { content: [[{ blocks: ['cell'] }], [{ rowId, blocks: [id] }]] });

        return { rowId, id, metadataBlock: ctx.read(rowId) };
      } },
    });
    const { plan, draft } = planOn(doc, [{ name: 'table.add', args: { id: 'tbl' } }], setup);

    expect(plan.results).toEqual([{ rowId: 'n1', id: 'n2', metadataBlock: null }]);
    expect(draft.has('n1')).toBe(false);
    expect(plan.changed.created).toEqual(['n2']);
    expect(draft.cellOf('n2')).toEqual({ tableId: 'tbl', row: 1, col: 0 });
  });
});

describe('recording context patches and rich text', () => {
  it('shallow-merges a patch and later reads see the new data', () => {
    const setup = withActions('paragraph', {
      patch: { run: (ctx: ToolActionContext) => {
        ctx.update(blockOf(ctx).id, { options: { second: 3 }, text: 'Changed' });

        return ctx.read(blockOf(ctx).id);
      } },
    });
    const { plan, draft } = planOn(doc, [{ name: 'paragraph.patch', args: { id: 'p' } }], setup);

    expect(draft.get('p')?.data).toEqual({ text: [{ text: 'Changed' }], old: 'remove', options: { second: 3 } });
    expect(plan.results).toEqual([{
      id: 'p', type: 'paragraph', parentId: null, children: [],
      data: { text: [{ text: 'Changed' }], old: 'remove', options: { second: 3 } },
    }]);
    expect(plan.edits).toEqual([
      { op: 'setRichText', id: 'p', field: 'text', value: [{ text: 'Changed' }] },
      { op: 'setData', id: 'p', patch: { options: { second: 3 } } },
    ]);
  });

  it.each([
    { label: 'ordinary undefined', patch: { old: undefined }, removed: 'old', retained: { text: [{ text: 'Before' }], options: { first: 1, second: 2 } } },
    { label: 'ordinary null', patch: { old: null }, removed: 'old', retained: { text: [{ text: 'Before' }], options: { first: 1, second: 2 } } },
    { label: 'rich undefined', patch: { text: undefined }, removed: 'text', retained: { old: 'remove', options: { first: 1, second: 2 } } },
    { label: 'rich null', patch: { text: null }, removed: 'text', retained: { old: 'remove', options: { first: 1, second: 2 } } },
  ])('encodes $label removal with a JSON-surviving null marker', ({ patch, removed, retained }) => {
    const setup = withActions('paragraph', {
      clear: { run: (ctx: ToolActionContext) => {
        ctx.update(blockOf(ctx).id, patch);

        return ctx.read(blockOf(ctx).id);
      } },
    });
    const { plan, draft } = planOn(doc, [{ name: 'paragraph.clear', args: { id: 'p' } }], setup);

    expect(draft.get('p')?.data).not.toHaveProperty(removed);
    expect(plan.edits).toEqual([{ op: 'setData', id: 'p', patch: { [removed]: null } }]);
    expect(JSON.stringify(plan.edits)).toBe(JSON.stringify([{ op: 'setData', id: 'p', patch: { [removed]: null } }]));
    expect(draft.get('p')?.data).toEqual(retained);
    expect(recordOf(plan.results[0]).data).toEqual(retained);
  });

  it('uses the same ordinary removal encoding for block.update and ctx.update', () => {
    const setup = withActions('paragraph', { clear: { run: (ctx: ToolActionContext) => ctx.update(blockOf(ctx).id, { old: undefined }) } });
    const action = planOn(doc, [{ name: 'paragraph.clear', args: { id: 'p' } }], setup);
    const core = planOn(doc, [{ name: 'block.update', args: { id: 'p', data: { old: null } } }], setup);

    expect(action.plan.edits).toEqual([{ op: 'setData', id: 'p', patch: { old: null } }]);
    expect(core.plan.edits).toEqual([{ op: 'setData', id: 'p', patch: { old: null } }]);
    expect(action.draft.get('p')?.data).toEqual(core.draft.get('p')?.data);
  });

  it('preserves false, zero, empty string and nested null rather than deleting them', () => {
    const setup = withActions('paragraph', {
      patch: { run: (ctx: ToolActionContext) => ctx.update(blockOf(ctx).id, {
        text: '', flag: false, count: 0, label: '', nested: { value: null },
      }) },
    });
    const { plan, draft } = planOn(doc, [{ name: 'paragraph.patch', args: { id: 'p' } }], setup);

    expect(draft.get('p')?.data).toMatchObject({
      text: [], flag: false, count: 0, label: '', nested: { value: null },
    });
    expect(plan.edits).toEqual([
      { op: 'setRichText', id: 'p', field: 'text', value: [] },
      { op: 'setData', id: 'p', patch: { flag: false, count: 0, label: '', nested: { value: null } } },
    ]);
  });

  it.each(['constructor', 'toString', '__proto__'])('writes and removes an own JSON key named %s', field => {
    const setup = withActions('paragraph', {
      change: { run: (ctx: ToolActionContext) => {
        ctx.update(blockOf(ctx).id, { [field]: { value: 'kept' } });
        const written = structuredClone(ctx.read(blockOf(ctx).id));

        ctx.update(blockOf(ctx).id, { [field]: undefined });

        return { written, removed: ctx.read(blockOf(ctx).id) };
      } },
    });
    const { plan, draft } = planOn(doc, [{ name: 'paragraph.change', args: { id: 'p' } }], setup);
    const result = recordOf(plan.results[0]);
    const written = recordOf(recordOf(result.written).data);

    expect(Object.hasOwn(written, field)).toBe(true);
    expect(written[field]).toEqual({ value: 'kept' });
    expect(Object.hasOwn(recordOf(recordOf(result.removed).data), field)).toBe(false);
    expect(Object.hasOwn(draft.get('p')?.data ?? {}, field)).toBe(false);
    expect(plan.edits).toEqual([
      { op: 'setData', id: 'p', patch: { [field]: { value: 'kept' } } },
      { op: 'setData', id: 'p', patch: { [field]: null } },
    ]);
  });

  it('retains core guarded-field checks while an action writes its guarded field', () => {
    const setup = withActions('table', {
      clear: { run: (ctx: ToolActionContext) => ctx.update(blockOf(ctx).id, { content: [] }) },
    });
    const action = planOn(doc, [{ name: 'table.clear', args: { id: 'tbl' } }], setup);

    expect(action.draft.get('tbl')?.data.content).toEqual([]);
    expect(action.plan.edits).toEqual([{ op: 'setData', id: 'tbl', patch: { content: [] } }]);
    expect(failOf(() => planOn(doc, [{ name: 'block.update', args: { id: 'tbl', data: { content: [] } } }], setup)))
      .toMatchObject({
        code: 'FIELD_NOT_WRITABLE', path: '/commands/0/args/data/content',
        details: { reason: 'guarded', field: 'content', use: 'table.*' },
      });
  });

  it('keeps the core view-state prohibition when sharing patch emission with actions', () => {
    const setup = withActions('image', { inspect: { run: () => ({}) } });
    const input: OutputData = { blocks: [{ id: 'img', type: 'image', data: { url: 'u', zoom: 1 } }] };

    expect(failOf(() => planOn(input, [{ name: 'block.update', args: { id: 'img', data: { zoom: 2 } } }], setup)))
      .toMatchObject({
        code: 'FIELD_NOT_WRITABLE', path: '/commands/0/args/data/zoom',
        details: { reason: 'view-state', field: 'zoom' },
      });
  });

  it.each([
    { label: 'change', value: 2 },
    { label: 'null removal', value: null },
    { label: 'undefined removal', value: undefined },
    { label: 'equal value', value: 1 },
  ])('refuses a direct action view-state $label', ({ value }) => {
    const setup = withActions('image', {
      change: { run: (ctx: ToolActionContext) => ctx.update(blockOf(ctx).id, { zoom: value }) },
    });
    const input: OutputData = { blocks: [{ id: 'img', type: 'image', data: { url: 'u', zoom: 1 } }] };
    const error = failOf(() => planOn(input, [{ name: 'image.change', args: { id: 'img' } }], setup));

    expect(error).toMatchObject({
      code: 'FIELD_NOT_WRITABLE', details: { reason: 'view-state', field: 'zoom' },
    });
    expect(error).toMatchObject({ commandIndex: 0, path: '/commands/0/args/data/zoom', retryable: false });
  });

  it.each([
    { mode: 'create', existing: { url: 'u' } },
    { mode: 'change', existing: { url: 'u', zoom: 1 } },
    { mode: 'remove', existing: { url: 'u', zoom: 1 } },
  ])('refuses a normalizer-derived action view-state $mode', ({ mode, existing }) => {
    const normalize = (data: Record<string, unknown>): Record<string, unknown> => mode === 'remove'
      ? Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'zoom'))
      : { ...data, zoom: 2 };
    const setup = withActions('image', {
      change: { run: (ctx: ToolActionContext) => ctx.update(blockOf(ctx).id, { url: 'changed' }) },
    }, {}, {}, { normalize });
    const input: OutputData = { blocks: [{ id: 'img', type: 'image', data: existing }] };
    const error = failOf(() => planOn(input, [{ name: 'image.change', args: { id: 'img' } }], setup));

    expect(error).toMatchObject({
      code: 'FIELD_NOT_WRITABLE', details: { reason: 'view-state', field: 'zoom' },
    });
    expect(error).toMatchObject({ commandIndex: 0, path: '/commands/0/args/data/zoom', retryable: false });
  });

  it('sanitizes the patch and normalizes the full merged block before recording derived fields', () => {
    const normalize = (data: Record<string, unknown>): Record<string, unknown> => ({
      ...data, level: data.level ?? 2, derived: data.label === 'clean',
    });
    const setup = withActions('header', {
      change: { run: (ctx: ToolActionContext) => {
        ctx.update(blockOf(ctx).id, { text: 'New', label: 'dirty', old: undefined });

        return ctx.read(blockOf(ctx).id);
      } },
    }, {}, {}, { normalize });
    const sanitizeBlockData = (_type: string, data: Record<string, unknown>): Record<string, unknown> =>
      Object.hasOwn(data, 'label') ? { ...data, label: 'clean' } : data;
    const { plan, draft } = planOn(doc, [{ name: 'header.change', args: { id: 'h' } }], {
      ...setup, ports: stubPorts({ sanitizeBlockData }),
    });

    expect(draft.get('h')?.data).toEqual({ text: [{ text: 'New' }], level: 5, label: 'clean', derived: true });
    expect(plan.edits).toEqual([
      { op: 'setRichText', id: 'h', field: 'text', value: [{ text: 'New' }] },
      { op: 'setData', id: 'h', patch: { old: null, label: 'clean', derived: true } },
    ]);
    expect(plan.warnings).toEqual([expect.objectContaining({
      code: 'SANITIZED', commandIndex: 0, blockId: 'h', field: 'label',
    })]);
    expect(recordOf(plan.results[0]).data).toEqual({ text: [{ text: 'New' }], level: 5, label: 'clean', derived: true });
  });

  it('records rich fields changed by normalization and sanitizes the normalized value', () => {
    const setup = withActions('header', {
      change: { run: (ctx: ToolActionContext) => ctx.update(blockOf(ctx).id, { level: 3 }) },
    }, {}, {}, { normalize: data => ({
      ...data, text: [{ text: 'A', marks: { bold: true } }, { text: 'B', marks: { bold: true } }],
    }) });
    const sanitizeBlockData = (_type: string, data: Record<string, unknown>): Record<string, unknown> => {
      const first = isArray(data.text) ? data.text[0] : undefined;

      return isRecord(first) && first.text === 'AB'
        ? { ...data, text: [{ text: 'Clean', marks: { bold: true } }] }
        : data;
    };
    const { plan, draft } = planOn(doc, [{ name: 'header.change', args: { id: 'h' } }], {
      ...setup, ports: stubPorts({ sanitizeBlockData }),
    });

    expect(draft.get('h')?.data.text).toEqual([{ text: 'Clean', marks: { bold: true } }]);
    expect(plan.edits).toEqual([
      { op: 'setRichText', id: 'h', field: 'text', value: [{ text: 'Clean', marks: { bold: true } }] },
      { op: 'setData', id: 'h', patch: { level: 3 } },
    ]);
  });

  it('records ordinary and rich keys omitted by the whole-record normalizer', () => {
    const setup = withActions('header', {
      change: { run: (ctx: ToolActionContext) => ctx.update(blockOf(ctx).id, { level: 3 }) },
    }, {}, {}, { normalize: data => ({ level: data.level }) });
    const { plan, draft } = planOn(doc, [{ name: 'header.change', args: { id: 'h' } }], setup);

    expect(draft.get('h')?.data).toEqual({ level: 3 });
    expect(plan.edits).toEqual([{ op: 'setData', id: 'h', patch: { level: 3, text: null, old: null } }]);
  });

  it.each([
    { label: 'non-string text', value: [{ text: 42 }] },
    { label: 'ambiguous segment', value: [{ text: 'A', embed: { html: 'B' } }] },
    { label: 'invalid page embed', value: [{ embed: { page: { id: 7 } } }] },
  ])('preserves typed validation for an action patch containing $label', ({ value }) => {
    const setup = withActions('paragraph', {
      change: { run: (ctx: ToolActionContext) => ctx.update(blockOf(ctx).id, { text: value }) },
    });

    expect(failOf(() => planOn(doc, [{ name: 'paragraph.change', args: { id: 'p' } }], setup)))
      .toMatchObject({ code: 'INVALID_ARGS', commandIndex: 0 });
  });

  it('rejects malformed rich text produced by normalization rather than recording it', () => {
    const setup = withActions('header', {
      change: { run: (ctx: ToolActionContext) => ctx.update(blockOf(ctx).id, { level: 3 }) },
    }, {}, {}, { normalize: data => ({ ...data, text: [{ text: 42 }] }) });

    expect(failOf(() => planOn(doc, [{ name: 'header.change', args: { id: 'h' } }], setup)))
      .toMatchObject({ code: 'INVALID_ARGS', commandIndex: 0 });
  });

  it('records every declared rich field separately when an action updates two fields', () => {
    const setup = withActions('two', {
      change: { run: (ctx: ToolActionContext) => ctx.update(blockOf(ctx).id, { body: 'Body', title: 'Title', count: 2 }) },
    }, {}, { richTextFields: ['title', 'body'] });
    const input: OutputData = { blocks: [{ id: 'two', type: 'two', data: { title: [], body: [], count: 1 } }] };
    const { plan, draft } = planOn(input, [{ name: 'two.change', args: { id: 'two' } }], setup);

    expect(draft.get('two')?.data).toEqual({ title: [{ text: 'Title' }], body: [{ text: 'Body' }], count: 2 });
    expect(plan.edits).toEqual([
      { op: 'setRichText', id: 'two', field: 'title', value: [{ text: 'Title' }] },
      { op: 'setRichText', id: 'two', field: 'body', value: [{ text: 'Body' }] },
      { op: 'setData', id: 'two', patch: { count: 2 } },
    ]);
    expect(plan.changed.updated).toEqual(['two']);
  });

  it('lets an action compose the published richText helpers and record the result with setRichText', () => {
    const setup = withActions('paragraph', {
      edit: { run: (ctx: ToolActionContext) => {
        const current = recordOf(readOf(ctx, blockOf(ctx).id).data).text;

        if (!isRichText(current)) {
          return ctx.fail('INVALID_ARGS', 'Text must contain segments.');
        }
        const range = ctx.richText.resolve(current, { find: 'Before' });
        const sliced = ctx.richText.slice(current, range.start, range.end);
        const inserted = ctx.richText.insert(sliced, 6, [{ text: '!' }]);
        const withoutBang = ctx.richText.remove(inserted, 6, 7);
        const marked = ctx.richText.format(withoutBang, 0, 6, { bold: true });
        const value = ctx.richText.canonicalize(marked);

        ctx.setRichText(blockOf(ctx).id, 'text', value);

        return { plain: ctx.richText.plainText(value), length: ctx.richText.length(value), read: ctx.read(blockOf(ctx).id) };
      } },
    });
    const { plan, draft } = planOn(doc, [{ name: 'paragraph.edit', args: { id: 'p' } }], setup);

    expect(draft.get('p')?.data.text).toEqual([{ text: 'Before', marks: { bold: true } }]);
    expect(plan.edits).toEqual([{ op: 'setRichText', id: 'p', field: 'text', value: [{ text: 'Before', marks: { bold: true } }] }]);
    expect(plan.results).toEqual([{
      plain: 'Before', length: 6,
      read: {
        id: 'p', type: 'paragraph', parentId: null, children: [],
        data: { text: [{ text: 'Before', marks: { bold: true } }], old: 'remove', options: { first: 1, second: 2 } },
      },
    }]);
  });

  it('canonicalizes and sanitizes a direct setRichText value before later reads', () => {
    const value: RichText = [{ text: 'A', marks: { bold: true } }, { text: 'B', marks: { bold: true } }];
    const setup = withActions('paragraph', {
      edit: { run: (ctx: ToolActionContext) => {
        ctx.setRichText(blockOf(ctx).id, 'text', value);

        return ctx.read(blockOf(ctx).id);
      } },
    });
    const sanitizeBlockData = (_type: string, data: Record<string, unknown>): Record<string, unknown> => {
      const first = isArray(data.text) ? data.text[0] : undefined;

      return isRecord(first) && first.text === 'AB' ? { ...data, text: [{ text: 'Clean' }] } : data;
    };
    const { plan, draft } = planOn(doc, [{ name: 'paragraph.edit', args: { id: 'p' } }], {
      ...setup, ports: stubPorts({ sanitizeBlockData }),
    });

    expect(draft.get('p')?.data.text).toEqual([{ text: 'Clean' }]);
    expect(plan.edits).toEqual([{ op: 'setRichText', id: 'p', field: 'text', value: [{ text: 'Clean' }] }]);
    expect(recordOf(plan.results[0]).data).toMatchObject({ text: [{ text: 'Clean' }] });
    expect(plan.warnings).toContainEqual(expect.objectContaining({ code: 'SANITIZED', blockId: 'p', field: 'text' }));
  });

  it('keeps a tunes-only core update free of sanitizer-added data during helper extraction', () => {
    const setup = withActions('header', { inspect: { run: () => ({}) } });
    const sanitizeBlockData = (_type: string, data: Record<string, unknown>): Record<string, unknown> =>
      ({ ...data, label: 'must-not-be-added' });
    const { plan, draft } = planOn(doc, [{
      name: 'block.update', args: { id: 'h', tunes: { color: 'gray' } },
    }], { ...setup, ports: stubPorts({ sanitizeBlockData }) });

    expect(draft.get('h')?.data).toEqual({ text: [], level: 5, old: 'remove' });
    expect(plan.edits).toEqual([{ op: 'setTunes', id: 'h', tunes: { color: 'gray' } }]);
    expect(draft.get('h')?.tunes).toEqual({ color: 'gray' });
    expect(plan.results).toEqual([{ id: 'h' }]);
  });

  it('keeps equal explicit writes observable without rewriting untouched fields', () => {
    const setup = withActions('header', {
      change: { run: (ctx: ToolActionContext) => ctx.update(blockOf(ctx).id, { level: 5 }) },
    });
    const { plan, draft } = planOn(doc, [{ name: 'header.change', args: { id: 'h' } }], setup);

    expect(plan.edits).toEqual([{ op: 'setData', id: 'h', patch: { level: 5 } }]);
    expect(plan.changed.updated).toEqual(['h']);
    expect(draft.get('h')?.rest).toEqual({ lastEditedBy: 'agent', lastEditedAt: 1 });
  });

  it('does not let later caller changes alter recorded nested patch data', () => {
    const patch = { options: { second: 3 } };
    const before = structuredClone(doc);
    const setup = withActions('paragraph', {
      change: { run: (ctx: ToolActionContext) => {
        ctx.update(blockOf(ctx).id, patch);
        patch.options.second = 9;
      } },
    });
    const { plan, draft } = planOn(doc, [{ name: 'paragraph.change', args: { id: 'p' } }], setup);

    expect(draft.get('p')?.data.options).toEqual({ second: 3 });
    expect(plan.edits).toEqual([{ op: 'setData', id: 'p', patch: { options: { second: 3 } } }]);
    expect(doc).toEqual(before);
  });
});

describe('recording context placement rules', () => {
  it('moves into its self-placing owning container and later reads see both sides', () => {
    const input: OutputData = { blocks: [
      { id: 'tbl', type: 'table', data: { content: [] } },
      { id: 'p', type: 'paragraph', data: { text: [] } },
    ] };
    const setup = withActions('table', {
      adopt: { run: (ctx: ToolActionContext) => {
        ctx.move('p', { parentId: blockOf(ctx).id, position: 'end' });

        return { parent: ctx.read(blockOf(ctx).id), child: ctx.read('p') };
      } },
    });
    const { plan, draft } = planOn(input, [{ name: 'table.adopt', args: { id: 'tbl' } }], setup);

    expect(draft.childrenOf('tbl')).toEqual(['p']);
    expect(plan.edits).toEqual([{ op: 'move', id: 'p', parentId: 'tbl', afterId: null }]);
    expect(plan.results).toEqual([{
      parent: { id: 'tbl', type: 'table', data: { content: [] }, parentId: null, children: ['p'] },
      child: { id: 'p', type: 'paragraph', data: { text: [] }, parentId: 'tbl', children: [] },
    }]);
    expect(draft.childrenOf(null)).toEqual(['tbl']);
    expect(plan.changed).toEqual({ created: [], updated: [], moved: ['p'], removed: [] });
    expect(failOf(() => planOn(input, [{ name: 'block.move', args: { id: 'p', parentId: 'tbl', position: 'end' } }], setup)))
      .toMatchObject({ code: 'PLACEMENT_REFUSED', details: { reason: 'SELF_PLACED_PARENT' } });
  });

  it('refuses a disallowed child moved into the action\'s own owning destination', () => {
    const setup = withActions('frame', {
      adopt: { run: (ctx: ToolActionContext) => ctx.move('dv', { parentId: blockOf(ctx).id, position: 'end' }) },
    }, {}, {
      children: { accepts: true, allow: ['paragraph'], ownedByTool: true, layout: false, deletedWithParent: false },
    });
    const input: OutputData = { blocks: [
      { id: 'frame', type: 'frame', data: {} },
      { id: 'dv', type: 'divider', data: {} },
    ] };
    const error = failOf(() => planOn(input, [{ name: 'frame.adopt', args: { id: 'frame' } }], setup));

    expect(error).toMatchObject({ code: 'PLACEMENT_REFUSED', details: { reason: 'CHILD_NOT_ALLOWED' } });
    expect(error).toMatchObject({ commandIndex: 0, details: { allowed: ['paragraph'] } });
  });

  it('reorders children of its self-placing parent within the same cell', () => {
    const input: OutputData = { blocks: [
      { id: 'tbl', type: 'table', data: { content: [[{ blocks: ['a', 'b'] }]] }, content: ['a', 'b'] },
      { id: 'a', type: 'paragraph', data: { text: [] }, parent: 'tbl' },
      { id: 'b', type: 'paragraph', data: { text: [] }, parent: 'tbl' },
    ] };
    const setup = withActions('table', {
      reorder: { run: (ctx: ToolActionContext) => {
        ctx.move('b', { position: { before: 'a' } });

        return ctx.read(blockOf(ctx).id);
      } },
    });
    const { plan, draft } = planOn(input, [{ name: 'table.reorder', args: { id: 'tbl' } }], setup);

    expect(draft.childrenOf('tbl')).toEqual(['b', 'a']);
    expect(plan.edits).toEqual([{ op: 'move', id: 'b', parentId: 'tbl', afterId: null }]);
    expect(recordOf(plan.results[0]).children).toEqual(['b', 'a']);
  });

  it('reorders a last sibling without emitting an anchor that names itself', () => {
    const setup = withActions('paragraph', { reorder: { run: (ctx: ToolActionContext) => ctx.move('dv', { position: 'end' }) } });
    const { plan, draft } = planOn(doc, [{ name: 'paragraph.reorder', args: { id: 'p' } }], setup);

    expect(plan.edits).toEqual([{ op: 'move', id: 'dv', parentId: null, afterId: 'h' }]);
    expect(draft.childrenOf(null)).toEqual(['tbl', 'p', 'tg', 'h', 'dv']);
  });

  it.each([
    { label: 'before itself', to: { position: { before: 'p' } }, code: 'INVALID_ARGS', reason: undefined },
    { label: 'after itself', to: { position: { after: 'p' } }, code: 'INVALID_ARGS', reason: undefined },
    { label: 'under itself', to: { parentId: 'p', position: 'end' }, code: 'PLACEMENT_REFUSED', reason: 'OWN_SUBTREE' },
  ] satisfies Array<{ label: string; to: Parameters<ToolActionContext['move']>[1]; code: string; reason: string | undefined }>)
  ('refuses a context move $label', ({ to, code, reason }) => {
    const setup = withActions('paragraph', { move: { run: (ctx: ToolActionContext) => ctx.move('p', to) } });
    const error = failOf(() => planOn(doc, [{ name: 'paragraph.move', args: { id: 'p' } }], setup));

    expect(error).toMatchObject({ code, commandIndex: 0 });
    if (reason !== undefined) {
      expect(error.details).toMatchObject({ reason });
    }
  });

  it('refuses moving a block beneath its descendant', () => {
    const setup = withActions('toggle', { move: { run: (ctx: ToolActionContext) => ctx.move('tg', { parentId: 'leaf', position: 'end' }) } });

    expect(failOf(() => planOn(doc, [{ name: 'toggle.move', args: { id: 'tg' } }], setup)))
      .toMatchObject({ code: 'PLACEMENT_REFUSED', details: { reason: 'OWN_SUBTREE' } });
  });

  const restrictedInsert: Array<{
    label: string; input: Parameters<ToolActionContext['insert']>[0]; code: string; reason: string | undefined;
  }> = [
    { label: 'leaf parent', input: { type: 'paragraph', parentId: 'dv' }, code: 'PLACEMENT_REFUSED', reason: 'TAKES_NO_CHILDREN' },
    { label: 'disallowed child', input: { type: 'table', parentId: 'tg' }, code: 'PLACEMENT_REFUSED', reason: 'CHILD_NOT_ALLOWED' },
    { label: 'restricted table-cell child', input: { type: 'header', parentId: 'cell' }, code: 'PLACEMENT_REFUSED', reason: 'RESTRICTED_IN_CELL' },
    { label: 'foreign sibling', input: { type: 'paragraph', parentId: 'tg', position: { after: 'p' } }, code: 'PLACEMENT_REFUSED', reason: 'NOT_A_CHILD' },
    { label: 'missing parent', input: { type: 'paragraph', parentId: 'gone' }, code: 'BLOCK_NOT_FOUND', reason: undefined },
  ];

  it.each(restrictedInsert)('retains the $label rule for action inserts', ({ input, code, reason }) => {
    const setup = withActions('paragraph', { add: { run: (ctx: ToolActionContext) => ctx.insert(input) } });
    const error = failOf(() => planOn(doc, [{ name: 'paragraph.add', args: { id: 'p' } }], setup));

    expect(error).toMatchObject({ code, commandIndex: 0 });
    if (reason !== undefined) {
      expect(error.details).toMatchObject({ reason });
    }
  });

  const restrictedMove: Array<{
    label: string; id: string; to: Parameters<ToolActionContext['move']>[1]; code: string; reason: string | undefined;
  }> = [
    { label: 'leaf parent', id: 'p', to: { parentId: 'dv', position: 'end' }, code: 'PLACEMENT_REFUSED', reason: 'TAKES_NO_CHILDREN' },
    { label: 'disallowed child', id: 'tbl', to: { parentId: 'tg', position: 'end' }, code: 'PLACEMENT_REFUSED', reason: 'CHILD_NOT_ALLOWED' },
    { label: 'foreign sibling', id: 'p', to: { parentId: 'tg', position: { after: 'h' } }, code: 'PLACEMENT_REFUSED', reason: 'NOT_A_CHILD' },
    { label: 'entering a table cell', id: 'p', to: { parentId: 'cell', position: 'end' }, code: 'PLACEMENT_REFUSED', reason: 'TABLE_CELL_BOUNDARY' },
    { label: 'leaving a table cell', id: 'cell', to: { parentId: null, position: 'end' }, code: 'PLACEMENT_REFUSED', reason: 'TABLE_CELL_BOUNDARY' },
    { label: 'missing block', id: 'gone', to: { position: 'end' }, code: 'BLOCK_NOT_FOUND', reason: undefined },
    { label: 'missing parent', id: 'p', to: { parentId: 'gone', position: 'end' }, code: 'BLOCK_NOT_FOUND', reason: undefined },
  ];

  it.each(restrictedMove)('retains the $label rule for action moves', ({ id, to, code, reason }) => {
    const setup = withActions('paragraph', { move: { run: (ctx: ToolActionContext) => ctx.move(id, to) } });
    const error = failOf(() => planOn(doc, [{ name: 'paragraph.move', args: { id: 'p' } }], setup));

    expect(error).toMatchObject({ code, commandIndex: 0 });
    if (reason !== undefined) {
      expect(error.details).toMatchObject({ reason });
    }
  });

  it('rejects a context move between two table cells', () => {
    const input: OutputData = { blocks: [
      { id: 'tbl', type: 'table', data: { content: [[{ blocks: ['a'] }, { blocks: ['b'] }]] }, content: ['a', 'b'] },
      { id: 'a', type: 'toggle', data: { text: [] }, parent: 'tbl', content: ['inside'] },
      { id: 'inside', type: 'paragraph', data: { text: [] }, parent: 'a' },
      { id: 'b', type: 'toggle', data: { text: [] }, parent: 'tbl' },
    ] };
    const setup = withActions('table', { move: { run: (ctx: ToolActionContext) => ctx.move('inside', { parentId: 'b', position: 'end' }) } });

    expect(failOf(() => planOn(input, [{ name: 'table.move', args: { id: 'tbl' } }], setup)))
      .toMatchObject({ code: 'PLACEMENT_REFUSED', details: { reason: 'TABLE_CELL_BOUNDARY' } });
  });
});

describe('recording context removal and batch overlays', () => {
  it('lifts children by default for a non-deleting container and reads the removal immediately', () => {
    const setup = withActions('toggle', {
      remove: { run: (ctx: ToolActionContext) => {
        ctx.remove(blockOf(ctx).id);

        return { gone: ctx.read('tg'), lifted: ctx.read('leaf') };
      } },
    });
    const { plan, draft } = planOn(doc, [{ name: 'toggle.remove', args: { id: 'tg' } }], setup);

    expect(plan.results).toEqual([{
      gone: null, lifted: { id: 'leaf', type: 'paragraph', data: { text: [] }, parentId: null, children: [] },
    }]);
    expect(draft.childrenOf(null)).toEqual(['tbl', 'p', 'leaf', 'h', 'dv']);
    expect(plan.changed).toEqual({ created: [], updated: [], moved: ['leaf'], removed: ['tg'] });
    expect(draft.get('leaf')?.rest).toEqual({ lastEditedBy: 'agent', lastEditedAt: 1 });
    expect(plan.edits).toEqual([{ op: 'remove', id: 'tg', withChildren: false }]);
  });

  it.each([
    { label: 'deletedWithParent', selfPlaces: false, deletedWithParent: true },
    { label: 'selfPlacesChildren', selfPlaces: true, deletedWithParent: false },
  ])('defaults to cascading for $label', ({ selfPlaces, deletedWithParent }) => {
    const setup = withActions('frame', {
      remove: { run: (ctx: ToolActionContext) => ctx.remove(blockOf(ctx).id) },
    }, {}, {
      selfPlacesChildren: selfPlaces,
      children: { accepts: true, ownedByTool: false, layout: false, deletedWithParent },
    });
    const input: OutputData = { blocks: [
      { id: 'frame', type: 'frame', data: {}, content: ['child'] },
      { id: 'child', type: 'toggle', data: { text: [] }, parent: 'frame', content: ['grandchild'] },
      { id: 'grandchild', type: 'paragraph', data: { text: [] }, parent: 'child' },
    ] };
    const { plan, draft } = planOn(input, [{ name: 'frame.remove', args: { id: 'frame' } }], setup);

    expect(draft.ids()).toEqual([]);
    expect(plan.edits).toEqual([{ op: 'remove', id: 'frame', withChildren: true }]);
    expect(plan.changed).toEqual({ created: [], updated: [], moved: [], removed: ['frame', 'child', 'grandchild'] });
    expect([...plan.touched]).toEqual([]);
  });

  it.each([
    { label: 'cascade override', withChildren: true, key: 'toggle', id: 'tg', removed: ['tg', 'leaf'], retained: 'p' },
    { label: 'lift override', withChildren: false, key: 'table', id: 'tbl', removed: ['tbl'], retained: 'cell' },
  ])('honors an explicit $label', ({ withChildren, key, id, removed, retained }) => {
    const setup = withActions(key, { remove: { run: (ctx: ToolActionContext) => ctx.remove(id, { withChildren }) } });
    const name: AgentCommand['name'] = `${key}.remove`;
    const { plan, draft } = planOn(doc, [{ name, args: { id } }], setup);

    expect(plan.changed.removed).toEqual(removed);
    expect(plan.edits).toEqual([{ op: 'remove', id, withChildren }]);
    expect(draft.has(retained)).toBe(true);
    if (!withChildren) {
      expect(draft.parentOf(retained)).toBeNull();
    }
  });

  it.each([
    { label: 'update', action: { run: (ctx: ToolActionContext) => ctx.update('gone', { label: 'x' }) } },
    { label: 'setRichText', action: { run: (ctx: ToolActionContext) => ctx.setRichText('gone', 'text', []) } },
    { label: 'remove', action: { run: (ctx: ToolActionContext) => ctx.remove('gone') } },
  ] satisfies Array<{ label: string; action: ToolActionImpl }>)
  ('reports a missing target for context $label without wrapping the typed failure', ({ action }) => {
    const setup = withActions('paragraph', { missing: action });

    expect(failOf(() => planOn(doc, [{ name: 'paragraph.missing', args: { id: 'p' } }], setup)))
      .toMatchObject({ code: 'BLOCK_NOT_FOUND', commandIndex: 0, path: '/commands/0/args/id' });
  });

  it('lets a later action observe earlier action writes in the same batch', () => {
    const setup = withActions('paragraph', {
      change: { run: (ctx: ToolActionContext) => ctx.update(blockOf(ctx).id, { text: 'First', old: null }) },
      inspect: { run: (ctx: ToolActionContext) => ({ block: ctx.block, read: ctx.read(blockOf(ctx).id) }) },
    });
    const { plan } = planOn(doc, [
      { name: 'paragraph.change', args: { id: 'p' } },
      { name: 'paragraph.inspect', args: { id: 'p' } },
    ], setup);

    expect(plan.results[1]).toEqual({
      block: { id: 'p', type: 'paragraph', data: { text: [{ text: 'First' }], options: { first: 1, second: 2 } }, children: [] },
      read: { id: 'p', type: 'paragraph', data: { text: [{ text: 'First' }], options: { first: 1, second: 2 } }, parentId: null, children: [] },
    });
    expect(plan.changed).toEqual({ created: [], updated: ['p'], moved: [], removed: [] });
  });

  it('records the ordered insert-update-move-remove overlay without touching the source', () => {
    const before = structuredClone(doc);
    const setup = withActions('paragraph', {
      gesture: { run: (ctx: ToolActionContext) => {
        const id = ctx.insert({ type: 'paragraph', data: { text: 'Inserted' } });

        ctx.update(id, { text: 'Updated' });
        ctx.move(id, { parentId: 'tg', position: 'end' });
        const moved = ctx.read(id);

        ctx.remove(id);

        return { moved, removed: ctx.read(id), parent: ctx.read('tg') };
      } },
    });
    const { plan, draft } = planOn(doc, [{ name: 'paragraph.gesture', args: { id: 'p' } }], setup);

    expect(plan.results).toEqual([{
      moved: { id: 'n1', type: 'paragraph', data: { text: [{ text: 'Updated' }] }, parentId: 'tg', children: [] },
      removed: null,
      parent: { id: 'tg', type: 'toggle', data: { text: [] }, parentId: null, children: ['leaf'] },
    }]);
    expect(plan.edits).toEqual([
      { op: 'insert', block: { id: 'n1', type: 'paragraph', data: { text: [{ text: 'Inserted' }] }, children: [] }, parentId: null, afterId: 'dv' },
      { op: 'setRichText', id: 'n1', field: 'text', value: [{ text: 'Updated' }] },
      { op: 'move', id: 'n1', parentId: 'tg', afterId: 'leaf' },
      { op: 'remove', id: 'n1', withChildren: false },
    ]);
    expect(plan.changed).toEqual({ created: [], updated: [], moved: [], removed: ['n1'] });
    expect([...plan.touched]).toEqual([]);
    expect(draft.has('n1')).toBe(false);
    expect(doc).toEqual(before);
  });
});

describe('bounded action ownership under controller ruling C2', () => {
  it('places children in a same-tool container created by this action and its contained machinery', () => {
    const setup = withActions('frame', {
      create: { run: (ctx: ToolActionContext) => {
        const id = ctx.insert({ type: ctx.tool });
        const part = ctx.insert({ type: 'part', parentId: id });
        const child = ctx.insert({ type: 'paragraph', data: { text: 'Inside' }, parentId: part });

        return { id, part, child };
      } },
    }, { create: 'create' }, {
      selfPlacesChildren: true,
      children: { accepts: true, allow: ['part'], ownedByTool: true, layout: false, deletedWithParent: true },
    });

    setup.tools.set('part', tool('part', {
      selfPlacesChildren: true,
      children: { accepts: true, allow: ['paragraph'], ownedByTool: true, layout: false, deletedWithParent: true },
    }));
    const { plan, draft } = planOn({ blocks: [] }, [{ name: 'frame.create', args: {} }], setup);

    expect(draft.childrenOf('n2')).toEqual(['n3']);
    expect(draft.childrenOf('n1')).toEqual(['n2']);
    expect(plan.results).toEqual([{ id: 'n1', part: 'n2', child: 'n3' }]);
    expect(plan.edits).toEqual([
      { op: 'insert', block: { id: 'n1', type: 'frame', data: {}, children: [] }, parentId: null, afterId: null },
      { op: 'insert', block: { id: 'n2', type: 'part', data: {}, children: [] }, parentId: 'n1', afterId: null },
      { op: 'insert', block: { id: 'n3', type: 'paragraph', data: { text: [{ text: 'Inside' }] }, children: [] }, parentId: 'n2', afterId: null },
    ]);
  });

  it.each([
    { type: 'frame', direction: 'into' },
    { type: 'frame', direction: 'out of' },
    { type: 'foreign', direction: 'into' },
    { type: 'foreign', direction: 'out of' },
  ])('refuses moving $direction an unrelated existing $type owner', ({ type, direction }) => {
    const setup = withActions('frame', {
      move: { run: (ctx: ToolActionContext) => ctx.move('p', {
        parentId: direction === 'into' ? 'other' : null, position: 'end',
      }) },
    }, {}, {
      children: { accepts: true, ownedByTool: true, layout: false, deletedWithParent: true },
    });

    setup.tools.set('foreign', tool('foreign', {
      children: { accepts: true, ownedByTool: true, layout: false, deletedWithParent: true },
    }));
    const input: OutputData = { blocks: [
      { id: 'target', type: 'frame', data: {} },
      { id: 'other', type, data: {}, ...(direction === 'out of' ? { content: ['p'] } : {}) },
      { id: 'p', type: 'paragraph', data: { text: [] }, ...(direction === 'out of' ? { parent: 'other' } : {}) },
    ] };
    const error = failOf(() => planOn(input, [{ name: 'frame.move', args: { id: 'target' } }], setup));

    expect(error).toMatchObject({ code: 'PLACEMENT_REFUSED', details: { reason: 'OWNS_CHILDREN' } });
    expect(error.commandIndex).toBe(0);
  });

  it('does not inherit another action\'s same-tool created-container privilege', () => {
    const setup = withActions('frame', {
      create: { run: (ctx: ToolActionContext) => ({ id: ctx.insert({ type: ctx.tool }) }) },
      adopt: { run: (ctx: ToolActionContext) => ctx.move('p', { parentId: 'n1', position: 'end' }) },
    }, { create: 'create' }, {
      children: { accepts: true, ownedByTool: true, layout: false, deletedWithParent: true },
    });
    const input: OutputData = { blocks: [
      { id: 'target', type: 'frame', data: {} },
      { id: 'p', type: 'paragraph', data: { text: [] } },
    ] };
    const error = failOf(() => planOn(input, [
      { name: 'frame.create', args: {} },
      { name: 'frame.adopt', args: { id: 'target' } },
    ], setup));

    expect(error).toMatchObject({ code: 'PLACEMENT_REFUSED', details: { reason: 'OWNS_CHILDREN' } });
    expect(error.commandIndex).toBe(1);
  });

  it('does not privilege an unrelated other-tool container created by this action', () => {
    const setup = withActions('frame', {
      adopt: { run: (ctx: ToolActionContext) => {
        const other = ctx.insert({ type: 'foreign' });

        ctx.move('p', { parentId: other, position: 'end' });
      } },
    }, {}, {
      children: { accepts: true, ownedByTool: true, layout: false, deletedWithParent: true },
    });

    setup.tools.set('foreign', tool('foreign', {
      children: { accepts: true, ownedByTool: true, layout: false, deletedWithParent: true },
    }));
    const input: OutputData = { blocks: [
      { id: 'target', type: 'frame', data: {} },
      { id: 'p', type: 'paragraph', data: { text: [] } },
    ] };
    const error = failOf(() => planOn(input, [{ name: 'frame.adopt', args: { id: 'target' } }], setup));

    expect(error).toMatchObject({ code: 'PLACEMENT_REFUSED', details: { reason: 'OWNS_CHILDREN' } });
  });

  it.each(['move', 'insert'])('refuses a %s into an unrelated self-placing destination even without ownership', method => {
    const setup = withActions('frame', {
      adopt: { run: (ctx: ToolActionContext) => method === 'move'
        ? ctx.move('p', { parentId: 'other', position: 'end' })
        : ctx.insert({ type: 'paragraph', parentId: 'other' }) },
    });

    setup.tools.set('foreign', tool('foreign', { selfPlacesChildren: true }));
    const input: OutputData = { blocks: [
      { id: 'target', type: 'frame', data: {} },
      { id: 'other', type: 'foreign', data: {} },
      { id: 'p', type: 'paragraph', data: { text: [] } },
    ] };
    const error = failOf(() => planOn(input, [{ name: 'frame.adopt', args: { id: 'target' } }], setup));

    expect(error).toMatchObject({ code: 'PLACEMENT_REFUSED', details: { reason: 'SELF_PLACED_PARENT' } });
  });

  it('allows a child to leave its own owner for an independently legal root destination', () => {
    const setup = withActions('frame', {
      release: { run: (ctx: ToolActionContext) => ctx.move('p', { parentId: null, position: 'end' }) },
    }, {}, {
      children: { accepts: true, ownedByTool: true, layout: false, deletedWithParent: true },
    });
    const input: OutputData = { blocks: [
      { id: 'target', type: 'frame', data: {}, content: ['p'] },
      { id: 'p', type: 'paragraph', data: { text: [] }, parent: 'target' },
    ] };
    const { plan, draft } = planOn(input, [{ name: 'frame.release', args: { id: 'target' } }], setup);

    expect(draft.parentOf('p')).toBeNull();
    expect(plan.edits).toEqual([{ op: 'move', id: 'p', parentId: null, afterId: 'target' }]);
    expect(draft.childrenOf('target')).toEqual([]);
  });

  it.each([
    { label: 'leaf', accepts: false, allow: undefined, reason: 'TAKES_NO_CHILDREN' },
    { label: 'disallowed child', accepts: true, allow: ['divider'], reason: 'CHILD_NOT_ALLOWED' },
  ])('retains the destination $label refusal when leaving its own owner', ({ accepts, allow, reason }) => {
    const setup = withActions('frame', {
      release: { run: (ctx: ToolActionContext) => ctx.move('p', { parentId: 'destination', position: 'end' }) },
    }, {}, {
      children: { accepts: true, ownedByTool: true, layout: false, deletedWithParent: true },
    });

    setup.tools.set('destination', tool('destination', {
      children: { accepts, ...(allow === undefined ? {} : { allow }), ownedByTool: false, layout: false, deletedWithParent: false },
    }));
    const input: OutputData = { blocks: [
      { id: 'target', type: 'frame', data: {}, content: ['p'] },
      { id: 'p', type: 'paragraph', data: { text: [] }, parent: 'target' },
      { id: 'destination', type: 'destination', data: {} },
    ] };
    const error = failOf(() => planOn(input, [{ name: 'frame.release', args: { id: 'target' } }], setup));

    expect(error).toMatchObject({ code: 'PLACEMENT_REFUSED', details: { reason } });
  });

  it.each(['move', 'insert'])('retains acceptsChildren refusal on its own owning target for a %s', method => {
    const setup = withActions('frame', {
      adopt: { run: (ctx: ToolActionContext) => method === 'move'
        ? ctx.move('p', { parentId: blockOf(ctx).id, position: 'end' })
        : ctx.insert({ type: 'paragraph', parentId: blockOf(ctx).id }) },
    }, {}, {
      children: { accepts: false, ownedByTool: true, layout: false, deletedWithParent: true },
    });
    const input: OutputData = { blocks: [
      { id: 'target', type: 'frame', data: {} },
      { id: 'p', type: 'paragraph', data: { text: [] } },
    ] };
    const error = failOf(() => planOn(input, [{ name: 'frame.adopt', args: { id: 'target' } }], setup));

    expect(error).toMatchObject({ code: 'PLACEMENT_REFUSED', details: { reason: 'TAKES_NO_CHILDREN' } });
  });

  it('retains ancestry refusal inside its own contained machinery', () => {
    const setup = withActions('frame', {
      move: { run: (ctx: ToolActionContext) => ctx.move(blockOf(ctx).id, { parentId: 'part', position: 'end' }) },
    }, {}, {
      children: { accepts: true, ownedByTool: true, layout: false, deletedWithParent: true },
    });

    setup.tools.set('part', tool('part', {
      children: { accepts: true, ownedByTool: true, layout: false, deletedWithParent: true },
    }));
    const input: OutputData = { blocks: [
      { id: 'target', type: 'frame', data: {}, content: ['part'] },
      { id: 'part', type: 'part', data: {}, parent: 'target' },
    ] };
    const error = failOf(() => planOn(input, [{ name: 'frame.move', args: { id: 'target' } }], setup));

    expect(error).toMatchObject({ code: 'PLACEMENT_REFUSED', details: { reason: 'OWN_SUBTREE' } });
  });

  it('retains the existing legal move between columns', () => {
    const setup = withActions('column_list', {
      move: { run: (ctx: ToolActionContext) => ctx.move('p', { parentId: 'b', position: 'end' }) },
    });
    const input: OutputData = { blocks: [
      { id: 'columns', type: 'column_list', data: {}, content: ['a', 'b'] },
      { id: 'a', type: 'column', data: {}, parent: 'columns', content: ['p'] },
      { id: 'b', type: 'column', data: {}, parent: 'columns' },
      { id: 'p', type: 'paragraph', data: { text: [] }, parent: 'a' },
    ] };
    const { plan, draft } = planOn(input, [{ name: 'column_list.move', args: { id: 'columns' } }], setup);

    expect(draft.parentOf('p')).toBe('b');
    expect(plan.edits).toEqual([{ op: 'move', id: 'p', parentId: 'b', afterId: null }]);
    expect(draft.childrenOf('a')).toEqual([]);
  });
});

describe('explicit removal precedence under controller ruling C4', () => {
  it.each([
    { path: 'core', label: 'null', value: null },
    { path: 'core', label: 'undefined', value: undefined },
    { path: 'action', label: 'null', value: null },
    { path: 'action', label: 'undefined', value: undefined },
  ])('keeps $path $label removals above same-key normalization defaults', ({ path, value }) => {
    const patch = { old: value, text: value };
    const setup = withActions('header', {
      clear: { run: (ctx: ToolActionContext) => ctx.update(blockOf(ctx).id, patch) },
    }, {}, {}, { normalize: data => ({
      ...data, old: data.old ?? 'Default', text: data.text ?? [{ text: 'Default' }], extra: data.extra ?? 'Kept',
    }) });
    const command: AgentCommand = path === 'core'
      ? { name: 'block.update', args: { id: 'h', data: patch } }
      : { name: 'header.clear', args: { id: 'h' } };
    const { plan, draft } = planOn(doc, [command], setup);

    expect(draft.get('h')?.data).toEqual({ level: 5, extra: 'Kept' });
    expect(plan.edits).toEqual([{ op: 'setData', id: 'h', patch: { old: null, text: null, extra: 'Kept' } }]);
  });
});

describe('fresh metadata IDs under controller ruling Q1', () => {
  it('skips existing, reserved, allocated and repeated metadata IDs without phantom blocks', () => {
    const ids = ['p', 'future', 'retired', 'metadata-a', 'metadata-a', 'metadata-b', 'metadata-a', 'metadata-b', 'block-id'];
    const newId = vi.fn(() => {
      const id = ids.shift();

      if (id === undefined) {
        throw new Error('Fixture ID sequence exhausted');
      }

      return id;
    });
    const setup = withActions('paragraph', {
      allocate: { run: (ctx: ToolActionContext) => {
        const first = ctx.newId();
        const second = ctx.newId();
        const block = ctx.insert({ type: 'paragraph', data: { text: [] } });

        return { first, second, block, firstView: ctx.read(first), secondView: ctx.read(second) };
      } },
    });
    const input: OutputData = { blocks: [{ id: 'p', type: 'paragraph', data: { text: [] } }] };
    const { plan, draft } = planOn(input, [
      { name: 'block.insert', args: { id: 'retired', type: 'paragraph', data: { text: [] } } },
      { name: 'block.delete', args: { id: 'retired' } },
      { name: 'paragraph.allocate', args: { id: 'p' } },
      { name: 'block.insert', args: { id: 'future', type: 'paragraph', data: { text: [] } } },
    ], { ...setup, ports: stubPorts({ newId }) });

    expect(plan.results[2]).toEqual({ first: 'metadata-a', second: 'metadata-b', block: 'block-id', firstView: null, secondView: null });
    expect(draft.ids()).toEqual(['p', 'block-id', 'future']);
    expect(plan.edits.flatMap(edit => edit.op === 'insert' ? [edit.block.id] : [])).toEqual(['retired', 'block-id', 'future']);
    expect(plan.changed.created).toEqual(['block-id', 'future']);
    expect(newId).toHaveBeenCalledTimes(9);
  });

  it('rejects an empty generated metadata ID with the existing error', () => {
    const setup = withActions('paragraph', { allocate: { run: (ctx: ToolActionContext) => ctx.newId() } });
    const error = failOf(() => planOn(doc, [{ name: 'paragraph.allocate', args: { id: 'p' } }], {
      ...setup, ports: stubPorts({ newId: () => '' }),
    }));

    expect(error).toMatchObject({ code: 'INVALID_ARGS', commandIndex: 0 });
    expect(error.message).toMatch(/empty/i);
  });
});

describe('synchronous action results under controller ruling Q2', () => {
  it.each(['promise', 'thenable'])('rejects a %s run result without awaiting it', kind => {
    const then = vi.fn();
    const setup = withActions('paragraph', {
      invalid: { run: () => kind === 'promise' ? Promise.resolve({}) : { then } },
    });
    const snapshot = DocSnapshot.fromOutput(doc);
    const error = failOf(() => planBatch({
      snapshot, batch: { commands: [{ name: 'paragraph.invalid', args: { id: 'p' } }] },
      ctx: plannerContext(setup), stamp: { actorId: 'agent', at: 1 }, warnings: [],
    }));

    expect(error).toMatchObject({ code: 'PRECONDITION_FAILED', commandIndex: 0 });
    expect(error.message).toMatch(/prepare/i);
    expect(then).not.toHaveBeenCalled();
    expect(snapshot.toOutput()).toEqual(doc);
  });
});

describe('detached read-time views under controller ruling Q3', () => {
  it('keeps retained target and read views consistent while fresh reads see recorded writes', () => {
    const setup = withActions('toggle', {
      change: { run: (ctx: ToolActionContext) => {
        const target = blockOf(ctx);
        const earlier = readOf(ctx, target.id);

        ctx.update(target.id, { text: 'After', options: { value: 'After' } });
        ctx.insert({ type: 'paragraph', parentId: target.id });

        return { target, earlier, fresh: ctx.read(target.id) };
      } },
    });
    const input: OutputData = { blocks: [
      { id: 'tg', type: 'toggle', data: { text: [{ text: 'Before' }], options: { value: 'Before' } }, content: ['leaf'] },
      { id: 'leaf', type: 'paragraph', data: { text: [] }, parent: 'tg' },
    ] };
    const { plan } = planOn(input, [{ name: 'toggle.change', args: { id: 'tg' } }], setup);
    const result = recordOf(plan.results[0]);
    const original = { id: 'tg', type: 'toggle', data: { text: [{ text: 'Before' }], options: { value: 'Before' } }, children: ['leaf'] };

    expect(result.earlier).toEqual({ ...original, parentId: null });
    expect(result.target).toEqual(original);
    expect(result.fresh).toEqual({
      id: 'tg', type: 'toggle', parentId: null, children: ['leaf', 'n1'],
      data: { text: [{ text: 'After' }], options: { value: 'After' } },
    });
    expect(plan.edits).toEqual([
      { op: 'setRichText', id: 'tg', field: 'text', value: [{ text: 'After' }] },
      { op: 'setData', id: 'tg', patch: { options: { value: 'After' } } },
      { op: 'insert', block: { id: 'n1', type: 'paragraph', data: {}, children: [] }, parentId: 'tg', afterId: 'leaf' },
    ]);
  });

  it.each(['target', 'read'])('isolates unrecorded mutations of a detached %s view', kind => {
    const setup = withActions('toggle', {
      inspect: { run: (ctx: ToolActionContext) => {
        const view = kind === 'target' ? blockOf(ctx) : readOf(ctx, 'tg');
        const data = recordOf(view.data);
        const text = data.text;
        const children = recordOf(view).children;

        if (!isArray(text) || !isArray(children)) {
          return ctx.fail('INVALID_ARGS', 'Fixture text and children must be arrays.');
        }
        recordOf(data.options).value = 'Local';
        recordOf(text[0]).text = 'Local';
        data.extra = 'Local';
        children.push('ghost');
        view.id = 'local-id';

        return { local: view, fresh: ctx.read('tg') };
      } },
    });
    const input: OutputData = { blocks: [
      { id: 'tg', type: 'toggle', data: { text: [{ text: 'Before' }], options: { value: 'Before' } }, content: ['leaf'] },
      { id: 'leaf', type: 'paragraph', data: { text: [] }, parent: 'tg' },
    ] };
    const before = structuredClone(input);
    const { plan, draft } = planOn(input, [{ name: 'toggle.inspect', args: { id: 'tg' } }], setup);
    const result = recordOf(plan.results[0]);

    expect(result.fresh).toEqual({
      id: 'tg', type: 'toggle', parentId: null, children: ['leaf'],
      data: { text: [{ text: 'Before' }], options: { value: 'Before' } },
    });
    expect(result.local).toMatchObject({
      id: 'local-id', children: ['leaf', 'ghost'],
      data: { text: [{ text: 'Local' }], options: { value: 'Local' }, extra: 'Local' },
    });
    expect(plan.edits).toEqual([]);
    expect(plan.changed).toEqual({ created: [], updated: [], moved: [], removed: [] });
    expect([...plan.touched]).toEqual([]);
    expect(draft.toOutput()).toEqual(before);
    expect(input).toEqual(before);
  });
});

describe('target rich-field declarations under controller ruling Q4', () => {
  it.each([
    { label: 'existing plain field', id: 'p', field: 'old' },
    { label: 'undeclared field', id: 'p', field: 'other' },
    { label: 'caller-only rich field', id: 'img', field: 'text' },
  ])('refuses setRichText on a $label', ({ id, field }) => {
    const setup = withActions('paragraph', {
      edit: { run: (ctx: ToolActionContext) => ctx.setRichText(id, field, [{ text: 'New' }]) },
    });
    const input: OutputData = { blocks: [...doc.blocks, { id: 'img', type: 'image', data: { url: 'u' } }] };
    const error = failOf(() => planOn(input, [{ name: 'paragraph.edit', args: { id: 'p' } }], setup));

    expect(error).toMatchObject({ code: 'FIELD_NOT_RICH_TEXT' });
    expect(error.commandIndex).toBe(0);
  });

  it('uses the written block\'s declaration rather than the caller tool\'s fields', () => {
    const setup = withActions('image', {
      edit: { run: (ctx: ToolActionContext) => ctx.setRichText('h', 'text', [{ text: 'New' }]) },
    });
    const input: OutputData = { blocks: [...doc.blocks, { id: 'img', type: 'image', data: { url: 'u' } }] };
    const { plan, draft } = planOn(input, [{ name: 'image.edit', args: { id: 'img' } }], setup);

    expect(draft.get('h')?.data.text).toEqual([{ text: 'New' }]);
    expect(plan.edits).toEqual([{ op: 'setRichText', id: 'h', field: 'text', value: [{ text: 'New' }] }]);
  });
});
