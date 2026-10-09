// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREPARE_PENDING } from '../../../../src/shared/agent/plan-state';
import { coreCommandMap, planOn, TOOLS, tool } from './fixtures';

import type { OutputData } from '../../../../types/data-formats/output-data';
import type { ToolActionContext, ToolActionImpl } from '../../../../types/tools/tool-description';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const withActions = () => {
  const prepare = vi.fn(() => Promise.resolve({ label: 'Prepared' }));
  const createRun = vi.fn((ctx: ToolActionContext, _args: unknown, prepared: unknown) => {
    let label = 'Draft';

    if (prepared !== undefined) {
      if (!isRecord(prepared) || typeof prepared.label !== 'string') {
        return ctx.fail('INVALID_ARGS', 'Preparation must provide a label.');
      }
      label = prepared.label;
    }

    return { id: ctx.insert({ type: ctx.tool, data: { label } }) };
  });
  const renameRun = vi.fn((ctx: ToolActionContext) => {
    const block = ctx.block;

    if (block === undefined) {
      return ctx.fail('INVALID_ARGS', 'A block is required.');
    }
    ctx.update(block.id, { label: 'Renamed' });

    return { id: block.id };
  });
  const actions: Readonly<Record<string, ToolActionImpl>> = {
    create: { prepare, run: createRun },
    rename: { prepare, run: renameRun },
  };
  const tools = new Map(TOOLS);
  const commands = coreCommandMap();

  tools.set('producer', tool('producer', {
    data: {
      type: 'object',
      properties: { label: { type: 'string' } },
      required: ['label'],
      additionalProperties: false,
    },
  }, { actions }));
  commands.set('producer.create', {
    name: 'producer.create',
    args: { type: 'object', additionalProperties: false },
    readOnly: false,
    available: true,
    source: { tool: 'producer', target: 'create' },
  });
  commands.set('producer.rename', {
    name: 'producer.rename',
    args: {
      type: 'object',
      properties: { id: { type: 'string', minLength: 1 } },
      required: ['id'],
      additionalProperties: false,
    },
    readOnly: false,
    available: true,
    source: { tool: 'producer', target: 'block' },
  });

  return { tools, commands, prepare, createRun, renameRun };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('prepare-backed create recording through the public planner', () => {
  it('records a real pending block and resolves its ref before preparation', () => {
    const doc: OutputData = { blocks: [] };
    const setup = withActions();
    const prepared = new Map<number, unknown>([[0, PREPARE_PENDING]]);
    const { plan, draft } = planOn(doc, [
      { name: 'producer.create', args: {}, ref: 'made' },
      { name: 'doc.read', args: { ids: ['$made'], detail: 'full' } },
    ], { ...setup, prepared });

    expect(plan.refs).toEqual({ made: 'n1' });
    expect(draft.has('n1')).toBe(true);
    expect(draft.get('n1')?.data).toEqual({ label: 'Draft' });
    expect(plan.results).toEqual([
      { id: 'n1' },
      {
        revision: '', rootId: null,
        blocks: [{ id: 'n1', type: 'producer', depth: 0, data: { label: 'Draft' } }],
      },
    ]);
    expect(plan.edits).toEqual([{
      op: 'insert', parentId: null, afterId: null,
      block: { id: 'n1', type: 'producer', data: { label: 'Draft' }, children: [] },
    }]);
    expect(plan.changed).toEqual({ created: ['n1'], updated: [], moved: [], removed: [] });
    expect([...plan.touched]).toEqual(['n1']);
    expect(setup.createRun).toHaveBeenCalledOnce();
    expect(setup.createRun.mock.calls[0]?.[2]).toBeUndefined();
    expect(setup.prepare).not.toHaveBeenCalled();
    expect(prepared.get(0)).toBe(PREPARE_PENDING);
    expect(doc).toEqual({ blocks: [] });
  });

  it('records the concrete prepared payload without running preparation', () => {
    const doc: OutputData = { blocks: [] };
    const setup = withActions();
    const payload = { label: 'Prepared' };
    const { plan, draft } = planOn(doc, [
      { name: 'producer.create', args: {}, ref: 'made' },
    ], { ...setup, prepared: new Map<number, unknown>([[0, payload]]) });

    expect(draft.get('n1')?.data).toEqual({ label: 'Prepared' });
    expect(plan.refs).toEqual({ made: 'n1' });
    expect(plan.results).toEqual([{ id: 'n1' }]);
    expect(plan.edits).toEqual([{
      op: 'insert', parentId: null, afterId: null,
      block: { id: 'n1', type: 'producer', data: { label: 'Prepared' }, children: [] },
    }]);
    expect(plan.changed).toEqual({ created: ['n1'], updated: [], moved: [], removed: [] });
    expect(setup.createRun).toHaveBeenCalledOnce();
    expect(setup.createRun.mock.calls[0]?.[2]).toBe(payload);
    expect(setup.prepare).not.toHaveBeenCalled();
    expect(doc).toEqual({ blocks: [] });
  });

  it('records a concrete undefined preparation result rather than deferring it', () => {
    const doc: OutputData = { blocks: [] };
    const setup = withActions();
    const prepared = new Map<number, unknown>([[0, undefined]]);
    const { plan, draft } = planOn(doc, [
      { name: 'producer.create', args: {}, ref: 'made' },
    ], { ...setup, prepared });

    expect(draft.get('n1')?.data).toEqual({ label: 'Draft' });
    expect(plan.refs).toEqual({ made: 'n1' });
    expect(plan.results).toEqual([{ id: 'n1' }]);
    expect(plan.edits).toEqual([{
      op: 'insert', parentId: null, afterId: null,
      block: { id: 'n1', type: 'producer', data: { label: 'Draft' }, children: [] },
    }]);
    expect(plan.changed).toEqual({ created: ['n1'], updated: [], moved: [], removed: [] });
    expect(setup.createRun).toHaveBeenCalledOnce();
    expect(setup.createRun.mock.calls[0]?.[2]).toBeUndefined();
    expect(setup.prepare).not.toHaveBeenCalled();
    expect(prepared.has(0)).toBe(true);
    expect(prepared.get(0)).toBeUndefined();
    expect(doc).toEqual({ blocks: [] });
  });

  it('keeps a pending block-target action deferred on its existing block', () => {
    const doc: OutputData = {
      blocks: [{ id: 'existing', type: 'producer', data: { label: 'Before' } }],
    };
    const setup = withActions();
    const prepared = new Map<number, unknown>([[0, PREPARE_PENDING]]);
    const { plan, draft } = planOn(doc, [
      { name: 'producer.rename', args: { id: 'existing' } },
    ], { ...setup, prepared });

    expect(plan.edits).toEqual([]);
    expect(draft.toOutput()).toEqual(doc);
    expect(plan.results).toEqual([{}]);
    expect(plan.refs).toEqual({});
    expect(plan.changed).toEqual({ created: [], updated: [], moved: [], removed: [] });
    expect([...plan.touched]).toEqual([]);
    expect(setup.renameRun).not.toHaveBeenCalled();
    expect(setup.createRun).not.toHaveBeenCalled();
    expect(setup.prepare).not.toHaveBeenCalled();
    expect(prepared.get(0)).toBe(PREPARE_PENDING);
  });
});
