import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import { runtimesFromTools, snapshotFromTools } from '../../../../src/components/tools/registry-snapshot';
import { destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';
import { COMMANDS } from '../../../../src/shared/agent/commands';
import { plannerContextFrom } from '../../../../src/shared/agent/context';
import { buildBuiltInSnapshot } from '../../../../src/shared/built-in-snapshot';
import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_TOOL_RUNTIMES, cleanupEmptiedColumnList as exportedCleanup } from '../../../../src/shared/tool-actions';
import {
  COLUMN_DEFAULT_CHILDREN,
  COLUMN_LIST_ACTION_HANDLERS,
  COLUMN_LIST_DEFAULT_CHILDREN,
  cleanupEmptiedColumnList,
} from '../../../../src/shared/tool-actions/columns';
import { COLUMN_LIST_ACTIONS, describeColumnList } from '../../../../src/shared/tool-descriptions/column-list';
import { buildAgentContract, buildToolManifest } from '../../../../src/shared/tool-manifest';
import { planOn, stubPorts } from '../agent/fixtures';
import { builtInEditorTools } from '../tool-descriptions/built-in-tools';
import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

import type { ToolRuntimeRegistry } from '../../../../src/shared/tool-actions/runtime';
import type { AgentCommand } from '../../../../types/agent';
import type { BlockPosition } from '../../../../types/api/blocks';
import type { OutputData } from '../../../../types/data-formats/output-data';
import type { ToolActionContext, ToolActionDeclaration, ToolActionImpl } from '../../../../types/tools/tool-description';
import type { FakeDoc } from './fake-ctx';

// Install under test/unit/shared/tool-actions; imports target that location.
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isArray = (value: unknown): value is unknown[] => Array.isArray(value);
const isStringArray = (value: unknown): value is string[] =>
  isArray(value) && value.every(item => typeof item === 'string');

const created = (value: unknown): { id: string; childIds: string[] } => {
  if (!isRecord(value) || typeof value.id !== 'string' || !isStringArray(value.childIds)) {
    throw new Error('Expected a created list and its column ids.');
  }

  return { id: value.id, childIds: value.childIds };
};

const added = (value: unknown): string => {
  if (!isRecord(value) || typeof value.id !== 'string') {
    throw new Error('Expected a created column id.');
  }

  return value.id;
};

const idAt = (ids: readonly string[], index: number): string => {
  const id = ids[index];

  if (id === undefined) {
    throw new Error('Expected a block id at this index.');
  }

  return id;
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

const rootIds = (doc: FakeDoc): string[] => [...doc.values()]
  .filter(block => block.parentId === null)
  .map(block => block.id);

const handlerOf = (name: string): ToolActionImpl => {
  const handler = COLUMN_LIST_ACTION_HANDLERS[name];

  if (handler === undefined) {
    throw new Error(`Missing column_list handler "${name}".`);
  }

  return handler;
};

const actionOf = (name: string): ToolActionDeclaration => {
  const action = COLUMN_LIST_ACTIONS.find(action => action.name === name);

  if (action === undefined) {
    throw new Error(`Missing column_list declaration "${name}".`);
  }

  return action;
};

const runtimeOf = (runtimes: ToolRuntimeRegistry, name: string) => {
  const runtime = runtimes.get(name);

  if (runtime === undefined) {
    throw new Error(`Missing runtime "${name}".`);
  }

  return runtime;
};

const planBuiltIn = (commands: AgentCommand[], doc: OutputData = { blocks: [] }) => {
  const manifest = buildToolManifest(buildBuiltInSnapshot({ blokVersion: 'task-38' }));
  const contract = buildAgentContract(manifest, COMMANDS, { runtime: 'node', services: [] });
  const ctx = plannerContextFrom(contract, BUILT_IN_TOOL_RUNTIMES, stubPorts(), validateAgainst, {});

  return planOn(doc, commands, ctx);
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('column_list create', () => {
  it.each([2, 3, 4, 5])('creates %i columns, each with exactly one empty paragraph', count => {
    const ctx = createFakeCtx(docOf([]), undefined, 'column_list');
    const result = created(handlerOf('create').run(ctx, { count }, undefined));

    expect(readOf(ctx, result.id).children).toEqual(result.childIds);
    expect(result.childIds).toHaveLength(count);
    expect(rootIds(ctx.doc)).toEqual([result.id]);
    expect(ctx.doc.size).toBe(1 + 2 * count);

    for (const columnId of result.childIds) {
      const column = readOf(ctx, columnId);
      const paragraphId = idAt(column.children, 0);

      expect(column).toMatchObject({ type: 'column', parentId: result.id, data: {} });
      expect(column.children).toHaveLength(1);
      expect(readOf(ctx, paragraphId)).toEqual({
        id: paragraphId, type: 'paragraph', data: { text: [] }, parentId: columnId, children: [],
      });
    }
  });

  it('uses the configured registry key for the list', () => {
    const ctx = createFakeCtx(docOf([]), undefined, 'layout');
    const result = created(handlerOf('create').run(ctx, { count: 2 }, undefined));

    expect(readOf(ctx, result.id).type).toBe('layout');
    expect(result.childIds.map(id => readOf(ctx, id).type)).toEqual(['column', 'column']);
  });

  const placements: Array<{ position: BlockPosition; before: boolean }> = [
    { position: 'start', before: true },
    { position: { before: 'b' }, before: true },
    { position: { after: 'b' }, before: false },
    { position: 'end', before: false },
  ];

  it.each(placements)('places a count-created row at root using $position', ({ position, before }) => {
    const ctx = createFakeCtx(docOf([{ id: 'b', type: 'paragraph', data: { text: [] } }]), undefined, 'column_list');
    const result = created(handlerOf('create').run(ctx, { count: 2, position }, undefined));

    expect(rootIds(ctx.doc)).toEqual(before ? [result.id, 'b'] : ['b', result.id]);
    expect(readOf(ctx, result.id).parentId).toBeNull();
  });

  it.each(placements)('places a count-created row inside its requested parent using $position', ({ position, before }) => {
    const ctx = createFakeCtx(docOf([
      { id: 'p', type: 'callout', data: {} },
      { id: 'b', type: 'paragraph', data: { text: [] }, parentId: 'p' },
    ]), undefined, 'column_list');
    const result = created(handlerOf('create').run(ctx, { count: 2, parentId: 'p', position }, undefined));

    expect(readOf(ctx, 'p').children).toEqual(before ? [result.id, 'b'] : ['b', result.id]);
    expect(readOf(ctx, result.id).parentId).toBe('p');
    expect(rootIds(ctx.doc)).toEqual(['p']);
  });

  it('wraps root blocks in caller order at the first requested block slot', () => {
    const ctx = createFakeCtx(docOf([
      { id: 'before', type: 'paragraph', data: {} },
      { id: 'a', type: 'paragraph', data: { text: [{ text: 'A' }] } },
      { id: 'between', type: 'paragraph', data: {} },
      { id: 'b', type: 'paragraph', data: { text: [{ text: 'B' }] } },
      { id: 'after', type: 'paragraph', data: {} },
    ]), undefined, 'column_list');
    const result = created(handlerOf('create').run(ctx, { from: ['b', 'a'] }, undefined));

    expect(rootIds(ctx.doc)).toEqual(['before', 'between', result.id, 'after']);
    expect(result.childIds.map(id => readOf(ctx, id).children)).toEqual([['b'], ['a']]);
    expect(readOf(ctx, 'b').parentId).toBe(idAt(result.childIds, 0));
    expect(readOf(ctx, 'a').parentId).toBe(idAt(result.childIds, 1));
    expect(dataOf(ctx, 'a')).toEqual({ text: [{ text: 'A' }] });
    expect(dataOf(ctx, 'b')).toEqual({ text: [{ text: 'B' }] });
  });

  it('wraps nested siblings under their shared parent and keeps each subtree', () => {
    const ctx = createFakeCtx(docOf([
      { id: 'p', type: 'callout', data: {} },
      { id: 'before', type: 'paragraph', data: {}, parentId: 'p' },
      { id: 'a', type: 'paragraph', data: { text: [{ text: 'A' }] }, parentId: 'p' },
      { id: 'between', type: 'paragraph', data: {}, parentId: 'p' },
      { id: 't', type: 'toggle', data: { text: [{ text: 'T' }] }, parentId: 'p' },
      { id: 'tc', type: 'paragraph', data: { text: [{ text: 'Child' }] }, parentId: 't' },
      { id: 'after', type: 'paragraph', data: {}, parentId: 'p' },
    ]), undefined, 'column_list');
    const result = created(handlerOf('create').run(ctx, { from: ['t', 'a'] }, undefined));

    expect(readOf(ctx, 'p').children).toEqual(['before', 'between', result.id, 'after']);
    expect(readOf(ctx, result.id).parentId).toBe('p');
    expect(result.childIds.map(id => readOf(ctx, id).children)).toEqual([['t'], ['a']]);
    expect(readOf(ctx, 't').children).toEqual(['tc']);
    expect(readOf(ctx, 'tc').parentId).toBe('t');
    expect(dataOf(ctx, 'tc')).toEqual({ text: [{ text: 'Child' }] });
    expect(rootIds(ctx.doc)).toEqual(['p']);
  });

  it('groups selected descendants with their selected ancestor rather than making extra columns', () => {
    const ctx = createFakeCtx(docOf([
      { id: 't', type: 'toggle', data: { text: [] } },
      { id: 'tc', type: 'paragraph', data: { text: [{ text: 'Child' }] }, parentId: 't' },
      { id: 'a', type: 'paragraph', data: { text: [] } },
    ]), undefined, 'column_list');
    const result = created(handlerOf('create').run(ctx, { from: ['t', 'tc', 'a'] }, undefined));

    expect(result.childIds.map(id => readOf(ctx, id).children)).toEqual([['t'], ['a']]);
    expect(readOf(ctx, 't').children).toEqual(['tc']);
    expect(readOf(ctx, 'tc').parentId).toBe('t');
    expect(rootIds(ctx.doc)).toEqual([result.id]);
  });

  it('filters descendants even when their selected ancestor is listed later', () => {
    const ctx = createFakeCtx(docOf([
      { id: 'before', type: 'paragraph', data: {} },
      { id: 't', type: 'toggle', data: { text: [{ text: 'T' }] } },
      { id: 'tc', type: 'paragraph', data: { text: [{ text: 'Child' }] }, parentId: 't' },
      { id: 'between', type: 'paragraph', data: {} },
      { id: 'a', type: 'paragraph', data: { text: [{ text: 'A' }] } },
      { id: 'after', type: 'paragraph', data: {} },
    ]), undefined, 'column_list');
    const result = created(handlerOf('create').run(ctx, { from: ['tc', 'a', 't'] }, undefined));

    expect(result.childIds.map(id => readOf(ctx, id).children)).toEqual([['a'], ['t']]);
    expect(rootIds(ctx.doc)).toEqual(['before', 'between', result.id, 'after']);
    expect(readOf(ctx, result.id).parentId).toBeNull();
    expect(readOf(ctx, 'a').parentId).toBe(idAt(result.childIds, 0));
    expect(readOf(ctx, 't').parentId).toBe(idAt(result.childIds, 1));
    expect(readOf(ctx, 't').children).toEqual(['tc']);
    expect(readOf(ctx, 'tc').parentId).toBe('t');
    expect(dataOf(ctx, 'tc')).toEqual({ text: [{ text: 'Child' }] });
  });

  it('refuses roots in different containers without recording writes', () => {
    const ctx = createFakeCtx(docOf([
      { id: 'p', type: 'toggle', data: { text: [] } },
      { id: 'a', type: 'paragraph', data: { text: [] }, parentId: 'p' },
      { id: 'b', type: 'paragraph', data: { text: [] } },
    ]), undefined, 'column_list');

    expect(() => handlerOf('create').run(ctx, { from: ['a', 'b'] }, undefined)).toThrow(FakeFailure);
    expect(ctx.edits).toEqual([]);
    expect(rootIds(ctx.doc)).toEqual(['p', 'b']);
    expect(readOf(ctx, 'p').children).toEqual(['a']);
  });

  it('refuses a selection with fewer than two roots without splitting its subtree', () => {
    const ctx = createFakeCtx(docOf([
      { id: 't', type: 'toggle', data: { text: [] } },
      { id: 'tc', type: 'paragraph', data: { text: [] }, parentId: 't' },
    ]), undefined, 'column_list');

    expect(() => handlerOf('create').run(ctx, { from: ['t', 'tc'] }, undefined)).toThrow(FakeFailure);
    expect(ctx.edits).toEqual([]);
    expect(readOf(ctx, 'tc').parentId).toBe('t');
  });

  it.each([
    { from: ['missing', 'a', 'b'] },
    { from: ['a', 'missing', 'b'] },
  ])('refuses stale referenced ids in $from without recording writes', ({ from }) => {
    const ctx = createFakeCtx(docOf([
      { id: 'a', type: 'paragraph', data: { text: [] } },
      { id: 'b', type: 'paragraph', data: { text: [] } },
    ]), undefined, 'column_list');

    expect(() => handlerOf('create').run(ctx, { from }, undefined)).toThrow(FakeFailure);
    expect(ctx.edits).toEqual([]);
    expect(rootIds(ctx.doc)).toEqual(['a', 'b']);
  });

  it('refuses duplicate referenced ids instead of leaving a phantom empty column', () => {
    const ctx = createFakeCtx(docOf([
      { id: 'a', type: 'paragraph', data: { text: [] } },
      { id: 'b', type: 'paragraph', data: { text: [] } },
    ]), undefined, 'column_list');

    expect(() => handlerOf('create').run(ctx, { from: ['a', 'b', 'a'] }, undefined)).toThrow(FakeFailure);
    expect(ctx.edits).toEqual([]);
    expect(rootIds(ctx.doc)).toEqual(['a', 'b']);
  });

  it('applies widths to newly created columns and omits an even-split ratio', () => {
    const ctx = createFakeCtx(docOf([]), undefined, 'column_list');
    const result = created(handlerOf('create').run(ctx, { count: 3, widths: [2, 1, 0.5] }, undefined));

    expect(result.childIds.map(id => dataOf(ctx, id))).toEqual([{ widthRatio: 2 }, {}, { widthRatio: 0.5 }]);
    expect(dataOf(ctx, result.id)).toEqual({});
  });
});

describe('column_list addColumn', () => {
  it.each([
    { at: 0, slot: 0 },
    { at: 1, slot: 1 },
    { at: 2, slot: 2 },
    { at: 10, slot: 2 },
  ])('inserts a paragraph-seeded column at $at', ({ at, slot }) => {
    const ctx = createFakeCtx(docOf([
      { id: 'list', type: 'column_list', data: {} },
      { id: 'c1', type: 'column', data: {}, parentId: 'list' },
      { id: 'p1', type: 'paragraph', data: { text: [] }, parentId: 'c1' },
      { id: 'c2', type: 'column', data: {}, parentId: 'list' },
      { id: 'p2', type: 'paragraph', data: { text: [] }, parentId: 'c2' },
    ]), 'list');
    const id = added(handlerOf('addColumn').run(ctx, { at }, undefined));
    const expected = ['c1', 'c2'];

    expected.splice(slot, 0, id);
    expect(readOf(ctx, 'list').children).toEqual(expected);
    expect(readOf(ctx, id)).toMatchObject({ type: 'column', parentId: 'list' });
    const children = readOf(ctx, id).children;

    expect(children).toHaveLength(1);
    expect(readOf(ctx, idAt(children, 0))).toMatchObject({ type: 'paragraph', data: { text: [] }, parentId: id });
  });

  it('resets existing uneven widths when adding a column without changing content or order', () => {
    const ctx = createFakeCtx(docOf([
      { id: 'before', type: 'paragraph', data: { text: [] } },
      { id: 'list', type: 'column_list', data: {} },
      { id: 'after', type: 'paragraph', data: { text: [] } },
      { id: 'c1', type: 'column', data: { widthRatio: 2 }, parentId: 'list' },
      { id: 'p1', type: 'paragraph', data: { text: [{ text: 'Left' }] }, parentId: 'c1' },
      { id: 'c2', type: 'column', data: { widthRatio: 0.5 }, parentId: 'list' },
      { id: 'p2', type: 'paragraph', data: { text: [{ text: 'Right' }] }, parentId: 'c2' },
      { id: 'moved', type: 'paragraph', data: { text: [{ text: 'Moved' }] } },
    ]), 'list');
    const id = added(handlerOf('addColumn').run(ctx, { at: 1, from: ['moved'] }, undefined));

    expect(['c1', id, 'c2'].map(column => Object.hasOwn(dataOf(ctx, column), 'widthRatio')))
      .toEqual([false, false, false]);
    expect(readOf(ctx, 'list').children).toEqual(['c1', id, 'c2']);
    expect(rootIds(ctx.doc)).toEqual(['before', 'list', 'after']);
    expect(dataOf(ctx, 'list')).toEqual({});
    expect(readOf(ctx, 'c1').children).toEqual(['p1']);
    expect(readOf(ctx, 'c2').children).toEqual(['p2']);
    expect(readOf(ctx, id).children).toEqual(['moved']);
    expect(readOf(ctx, 'p1').parentId).toBe('c1');
    expect(readOf(ctx, 'p2').parentId).toBe('c2');
    expect(readOf(ctx, 'moved').parentId).toBe(id);
    expect(dataOf(ctx, 'p1')).toEqual({ text: [{ text: 'Left' }] });
    expect(dataOf(ctx, 'p2')).toEqual({ text: [{ text: 'Right' }] });
    expect(dataOf(ctx, 'moved')).toEqual({ text: [{ text: 'Moved' }] });
  });

  it('moves supplied blocks in order into the new column without an empty seed', () => {
    const ctx = createFakeCtx(docOf([
      { id: 'list', type: 'column_list', data: {} },
      { id: 'c1', type: 'column', data: {}, parentId: 'list' },
      { id: 'c2', type: 'column', data: {}, parentId: 'list' },
      { id: 't', type: 'toggle', data: { text: [] } },
      { id: 'tc', type: 'paragraph', data: { text: [{ text: 'Child' }] }, parentId: 't' },
      { id: 'b', type: 'paragraph', data: { text: [{ text: 'B' }] } },
    ]), 'list');
    const id = added(handlerOf('addColumn').run(ctx, { at: 1, from: ['b', 't'] }, undefined));

    expect(readOf(ctx, id).children).toEqual(['b', 't']);
    expect(readOf(ctx, 'list').children).toEqual(['c1', id, 'c2']);
    expect(readOf(ctx, 'b').parentId).toBe(id);
    expect(readOf(ctx, 't').parentId).toBe(id);
    expect(readOf(ctx, 'tc').parentId).toBe('t');
    expect(readOf(ctx, 't').children).toEqual(['tc']);
    expect(ctx.edits.flatMap(edit => edit.op === 'insert' ? [edit.type] : [])).toEqual(['column']);
  });

  it.each([
    { from: ['missing', 'a', 'b'] },
    { from: ['a', 'missing', 'b'] },
    { from: ['a', 'b', 'a'] },
  ])('refuses missing or duplicate references in $from without recording writes', ({ from }) => {
    const ctx = createFakeCtx(docOf([
      { id: 'list', type: 'column_list', data: {} },
      { id: 'c1', type: 'column', data: { widthRatio: 2 }, parentId: 'list' },
      { id: 'c2', type: 'column', data: { widthRatio: 0.5 }, parentId: 'list' },
      { id: 'a', type: 'paragraph', data: { text: [] } },
      { id: 'b', type: 'paragraph', data: { text: [] } },
    ]), 'list');

    expect(() => handlerOf('addColumn').run(ctx, { at: 1, from }, undefined)).toThrow(FakeFailure);
    expect(ctx.edits).toEqual([]);
    expect(rootIds(ctx.doc)).toEqual(['list', 'a', 'b']);
    expect(readOf(ctx, 'list').children).toEqual(['c1', 'c2']);
    expect(readOf(ctx, 'a').parentId).toBeNull();
    expect(readOf(ctx, 'b').parentId).toBeNull();
    expect(['c1', 'c2'].map(id => dataOf(ctx, id))).toEqual([{ widthRatio: 2 }, { widthRatio: 0.5 }]);
  });
});

describe('column_list removeColumn and cleanup', () => {
  it('deletes the selected column subtree and leaves a two-column list intact', () => {
    const ctx = createFakeCtx(docOf([
      { id: 'list', type: 'column_list', data: {} },
      { id: 'c1', type: 'column', data: {}, parentId: 'list' },
      { id: 'p1', type: 'paragraph', data: {}, parentId: 'c1' },
      { id: 'c2', type: 'column', data: {}, parentId: 'list' },
      { id: 't', type: 'toggle', data: { text: [] }, parentId: 'c2' },
      { id: 'tc', type: 'paragraph', data: {}, parentId: 't' },
      { id: 'c3', type: 'column', data: {}, parentId: 'list' },
      { id: 'p3', type: 'paragraph', data: {}, parentId: 'c3' },
    ]), 'list');

    handlerOf('removeColumn').run(ctx, { index: 1 }, undefined);

    expect(ctx.read('tc')).toBeNull();
    expect(ctx.read('t')).toBeNull();
    expect(ctx.read('c2')).toBeNull();
    expect(readOf(ctx, 'list').children).toEqual(['c1', 'c3']);
    expect(readOf(ctx, 'p1').parentId).toBe('c1');
    expect(readOf(ctx, 'p3').parentId).toBe('c3');
  });

  it.each([null, 'outer'])('removing down to one column promotes survivors at the list slot under %s', parentId => {
    const doc = docOf([
      ...(parentId === null ? [] : [{ id: parentId, type: 'column', data: {} }]),
      { id: 'before', type: 'paragraph', data: {}, ...(parentId === null ? {} : { parentId }) },
      { id: 'list', type: 'column_list', data: {}, ...(parentId === null ? {} : { parentId }) },
      { id: 'after', type: 'paragraph', data: {}, ...(parentId === null ? {} : { parentId }) },
      { id: 'c1', type: 'column', data: {}, parentId: 'list' },
      { id: 'doomed', type: 'toggle', data: { text: [] }, parentId: 'c1' },
      { id: 'deep', type: 'paragraph', data: {}, parentId: 'doomed' },
      { id: 'c2', type: 'column', data: {}, parentId: 'list' },
      { id: 'a', type: 'toggle', data: { text: [] }, parentId: 'c2' },
      { id: 'nested', type: 'paragraph', data: { text: [{ text: 'Kept' }] }, parentId: 'a' },
      { id: 'b', type: 'paragraph', data: {}, parentId: 'c2' },
    ]);
    const ctx = createFakeCtx(doc, 'list');

    handlerOf('removeColumn').run(ctx, { index: 0 }, undefined);

    expect(parentId === null ? rootIds(doc) : readOf(ctx, parentId).children).toEqual(['before', 'a', 'b', 'after']);
    expect(readOf(ctx, 'a').parentId).toBe(parentId);
    expect(readOf(ctx, 'b').parentId).toBe(parentId);
    expect(readOf(ctx, 'a').children).toEqual(['nested']);
    expect(readOf(ctx, 'nested').parentId).toBe('a');
    expect(dataOf(ctx, 'nested')).toEqual({ text: [{ text: 'Kept' }] });
    for (const id of ['deep', 'doomed', 'c1', 'c2', 'list']) {
      expect(ctx.read(id), id).toBeNull();
    }
    if (parentId !== null) {
      expect(rootIds(doc)).toEqual([parentId]);
    }
  });

  it.each([null, 'outer'])('cleans a single surviving column in order under %s', parentId => {
    const doc = docOf([
      ...(parentId === null ? [] : [{ id: parentId, type: 'column', data: {} }]),
      { id: 'before', type: 'paragraph', data: {}, ...(parentId === null ? {} : { parentId }) },
      { id: 'list', type: 'column_list', data: {}, ...(parentId === null ? {} : { parentId }) },
      { id: 'after', type: 'paragraph', data: {}, ...(parentId === null ? {} : { parentId }) },
      { id: 'column', type: 'column', data: {}, parentId: 'list' },
      { id: 'a', type: 'toggle', data: { text: [] }, parentId: 'column' },
      { id: 'nested', type: 'paragraph', data: {}, parentId: 'a' },
      { id: 'b', type: 'paragraph', data: {}, parentId: 'column' },
    ]);
    const ctx = createFakeCtx(doc);

    const cleaned = cleanupEmptiedColumnList(ctx, 'list');

    expect(parentId === null ? rootIds(doc) : readOf(ctx, parentId).children).toEqual(['before', 'a', 'b', 'after']);
    expect(readOf(ctx, 'a').parentId).toBe(parentId);
    expect(readOf(ctx, 'b').parentId).toBe(parentId);
    expect(readOf(ctx, 'nested').parentId).toBe('a');
    expect(cleaned).toBe(true);
    expect(ctx.read('column')).toBeNull();
    expect(ctx.read('list')).toBeNull();
    expect(cleanupEmptiedColumnList(ctx, 'list')).toBe(false);
  });

  it.each([2, 3, 5])('does not touch a list with %i columns', count => {
    const ctx = createFakeCtx(docOf([
      { id: 'list', type: 'column_list', data: {} },
      ...Array.from({ length: count }, (_, index) => ({
        id: `c${index}`, type: 'column', data: {}, parentId: 'list',
      })),
    ]));
    const before = [...ctx.doc.values()].map(block => ({ ...block, children: [...block.children] }));

    expect(cleanupEmptiedColumnList(ctx, 'list')).toBe(false);
    expect(ctx.edits).toEqual([]);
    expect([...ctx.doc.values()]).toEqual(before);
  });

  it('does not touch a missing or zero-column list', () => {
    const ctx = createFakeCtx(docOf([{ id: 'list', type: 'column_list', data: {} }]));

    expect(cleanupEmptiedColumnList(ctx, 'missing')).toBe(false);
    expect(cleanupEmptiedColumnList(ctx, 'list')).toBe(false);
    expect(ctx.edits).toEqual([]);
    expect(ctx.read('list')).not.toBeNull();
  });

  it('refuses an out-of-range removal without recording writes', () => {
    const ctx = createFakeCtx(docOf([
      { id: 'list', type: 'column_list', data: {} },
      { id: 'c1', type: 'column', data: {}, parentId: 'list' },
      { id: 'c2', type: 'column', data: {}, parentId: 'list' },
    ]), 'list');

    expect(() => handlerOf('removeColumn').run(ctx, { index: 2 }, undefined)).toThrow(FakeFailure);
    expect(ctx.edits).toEqual([]);
    expect(readOf(ctx, 'list').children).toEqual(['c1', 'c2']);
  });

  it('exports the exact cleanup helper for core block.move', () => {
    expect(exportedCleanup).toBe(cleanupEmptiedColumnList);
  });
});

describe('column_list widths', () => {
  it('requires one ratio for every column', () => {
    const ctx = createFakeCtx(docOf([
      { id: 'list', type: 'column_list', data: {} },
      { id: 'c1', type: 'column', data: { widthRatio: 2 }, parentId: 'list' },
      { id: 'c2', type: 'column', data: { widthRatio: 3 }, parentId: 'list' },
    ]), 'list');

    expect(() => handlerOf('setWidths').run(ctx, { ratios: [1] }, undefined)).toThrow(FakeFailure);
    expect(ctx.edits).toEqual([]);
    expect(['c1', 'c2'].map(id => dataOf(ctx, id))).toEqual([{ widthRatio: 2 }, { widthRatio: 3 }]);
  });

  it('writes relative widths and deletes a previous ratio when it becomes one', () => {
    const ctx = createFakeCtx(docOf([
      { id: 'list', type: 'column_list', data: {} },
      { id: 'c1', type: 'column', data: { widthRatio: 7 }, parentId: 'list' },
      { id: 'c2', type: 'column', data: { widthRatio: 3 }, parentId: 'list' },
    ]), 'list');

    handlerOf('setWidths').run(ctx, { ratios: [0.5, 1] }, undefined);

    expect(dataOf(ctx, 'c2')).not.toHaveProperty('widthRatio');
    expect(dataOf(ctx, 'c1')).toEqual({ widthRatio: 0.5 });
  });
});

describe('column_list declarations and shared runtime', () => {
  it('declares exactly the four implemented actions with create/block targets', () => {
    expect(COLUMN_LIST_ACTIONS.map(action => [action.name, action.target])).toEqual([
      ['create', 'create'], ['addColumn', 'block'], ['removeColumn', 'block'], ['setWidths', 'block'],
    ]);
    expect(describeColumnList().actions).toBe(COLUMN_LIST_ACTIONS);
    expect(Object.keys(COLUMN_LIST_ACTION_HANDLERS).sort()).toEqual(COLUMN_LIST_ACTIONS.map(action => action.name).sort());
    expect(runtimeOf(BUILT_IN_TOOL_RUNTIMES, 'column_list').actions).toBe(COLUMN_LIST_ACTION_HANDLERS);
    for (const action of COLUMN_LIST_ACTIONS) {
      expect(typeof handlerOf(action.name).run, action.name).toBe('function');
    }
  });

  it.each([2, 3, 4, 5])('accepts the declared create count %i', count => {
    expect(validateAgainst(actionOf('create').args, { count })).toEqual([]);
  });

  it.each([
    {}, { count: 1 }, { count: 6 }, { count: 2.5 }, { count: 2, from: ['a', 'b'] },
    { from: [] }, { from: ['a'] }, { from: ['a', 2] }, { count: 2, widths: [0, 1] },
    { count: 2, widths: [-1, 1] },
  ])('rejects invalid declared create arguments %j', args => {
    expect(validateAgainst(actionOf('create').args, args).length).toBeGreaterThan(0);
  });

  it('accepts from creation, positive widths and zero-based column indices', () => {
    expect(validateAgainst(actionOf('create').args, { from: ['a', 'b'], widths: [0.5, 2] })).toEqual([]);
    expect(validateAgainst(actionOf('addColumn').args, { at: 0 })).toEqual([]);
    expect(validateAgainst(actionOf('addColumn').args, { at: 1, from: ['a', 'b'] })).toEqual([]);
    expect(validateAgainst(actionOf('removeColumn').args, { index: 0 })).toEqual([]);
    expect(validateAgainst(actionOf('setWidths').args, { ratios: [0.5, 1] })).toEqual([]);
  });

  it.each([
    { name: 'addColumn', args: {} },
    { name: 'addColumn', args: { at: -1 } },
    { name: 'addColumn', args: { at: 0.5 } },
    { name: 'removeColumn', args: {} },
    { name: 'removeColumn', args: { index: -1 } },
    { name: 'removeColumn', args: { index: 0.5 } },
    { name: 'setWidths', args: {} },
    { name: 'setWidths', args: { ratios: [0, 1] } },
    { name: 'setWidths', args: { ratios: [-1, 1] } },
    { name: 'setWidths', args: { ratios: ['1', 1] } },
  ])('rejects invalid $name declaration arguments $args', ({ name, args }) => {
    expect(validateAgainst(actionOf(name).args, args).length).toBeGreaterThan(0);
  });

  it('registers a one-paragraph column and two-column list default tree', () => {
    const paragraph = { type: 'paragraph', data: { text: [] } };

    expect(COLUMN_DEFAULT_CHILDREN).toEqual([paragraph]);
    expect(COLUMN_LIST_DEFAULT_CHILDREN).toEqual([
      { type: 'column', data: {}, children: [paragraph] },
      { type: 'column', data: {}, children: [paragraph] },
    ]);
    expect(runtimeOf(BUILT_IN_TOOL_RUNTIMES, 'column').defaultChildren).toBe(COLUMN_DEFAULT_CHILDREN);
    expect(runtimeOf(BUILT_IN_TOOL_RUNTIMES, 'column_list').defaultChildren).toBe(COLUMN_LIST_DEFAULT_CHILDREN);
  });

  it('publishes the real handlers in the built-in snapshot and executable contract', () => {
    const snapshot = buildBuiltInSnapshot({ blokVersion: 'task-38' });
    const block = snapshot.blocks.find(block => block.name === 'column_list');
    const contract = buildAgentContract(buildToolManifest(snapshot), COMMANDS, { runtime: 'node', services: [] });

    expect(block?.handlers.slice().sort()).toEqual(['addColumn', 'create', 'removeColumn', 'setWidths']);
    expect(contract.commands.filter(command => command.name.startsWith('column_list.'))
      .map(command => ({ name: command.name, available: command.available, source: command.source }))).toEqual([
      { name: 'column_list.addColumn', available: true, source: { tool: 'column_list', target: 'block' } },
      { name: 'column_list.create', available: true, source: { tool: 'column_list', target: 'create' } },
      { name: 'column_list.removeColumn', available: true, source: { tool: 'column_list', target: 'block' } },
      { name: 'column_list.setWidths', available: true, source: { tool: 'column_list', target: 'block' } },
    ]);
  });
});

describe('real shared planner and action-context controls', () => {
  it('seeds generic column_list insertion exactly once', () => {
    const { plan, draft } = planBuiltIn([{ name: 'block.insert', args: { type: 'column_list' }, ref: 'list' }]);
    const listId = plan.refs.list;

    if (listId === undefined) {
      throw new Error('Expected the inserted list ref.');
    }
    const columns = draft.childrenOf(listId);

    expect(columns).toHaveLength(2);
    expect(draft.ids()).toHaveLength(5);
    for (const id of columns) {
      const children = draft.childrenOf(id);

      expect(children).toHaveLength(1);
      expect(draft.get(idAt(children, 0))).toMatchObject({ type: 'paragraph', data: { text: [] }, parent: id });
    }
  });

  it('does not apply list defaults before a count handler adds its own columns', () => {
    const { plan, draft } = planBuiltIn([{ name: 'column_list.create', args: { count: 3 } }]);
    const result = created(plan.results[0]);

    expect(draft.childrenOf(result.id)).toEqual(result.childIds);
    expect(result.childIds).toHaveLength(3);
    expect(draft.ids()).toHaveLength(7);
    expect(result.childIds.map(id => draft.childrenOf(id).length)).toEqual([1, 1, 1]);
  });

  it('does not seed list columns or paragraphs before moving existing blocks', () => {
    const { plan, draft } = planBuiltIn([{ name: 'column_list.create', args: { from: ['a', 'b'] } }], {
      blocks: [
        { id: 'a', type: 'toggle', data: { text: [] }, content: ['ac'] },
        { id: 'ac', type: 'paragraph', data: { text: [{ text: 'Child' }] }, parent: 'a' },
        { id: 'b', type: 'paragraph', data: { text: [{ text: 'B' }] } },
      ],
    });
    const result = created(plan.results[0]);

    expect(result.childIds.map(id => draft.childrenOf(id))).toEqual([['a'], ['b']]);
    expect(draft.childrenOf(result.id)).toEqual(result.childIds);
    expect(draft.childrenOf('a')).toEqual(['ac']);
    expect(draft.ids()).toHaveLength(6);
    expect(plan.changed.created).toHaveLength(3);
  });

  it('does not seed a paragraph before addColumn moves an existing block', () => {
    const { plan, draft } = planBuiltIn([{ name: 'column_list.addColumn', args: { id: 'list', at: 1, from: ['a'] } }], {
      blocks: [
        { id: 'list', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'list', content: ['p1'] },
        { id: 'p1', type: 'paragraph', data: { text: [] }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'list', content: ['p2'] },
        { id: 'p2', type: 'paragraph', data: { text: [] }, parent: 'c2' },
        { id: 'a', type: 'paragraph', data: { text: [{ text: 'A' }] } },
      ],
    });
    const id = added(plan.results[0]);

    expect(draft.childrenOf(id)).toEqual(['a']);
    expect(draft.childrenOf('list')).toEqual(['c1', id, 'c2']);
    expect(plan.changed.created).toEqual([id]);
    expect(draft.ids()).toHaveLength(7);
  });

  it.each([null, 'outer'])('preserves survivors when real removal collapses a list under %s', parentId => {
    const { draft } = planBuiltIn([{ name: 'column_list.removeColumn', args: { id: 'list', index: 0 } }], {
      blocks: [
        ...(parentId === null ? [] : [{ id: parentId, type: 'column', data: {}, content: ['before', 'list', 'after'] }]),
        { id: 'before', type: 'paragraph', data: { text: [{ text: 'Before' }] }, ...(parentId === null ? {} : { parent: parentId }) },
        { id: 'list', type: 'column_list', data: {}, content: ['c1', 'c2'], ...(parentId === null ? {} : { parent: parentId }) },
        { id: 'after', type: 'paragraph', data: { text: [{ text: 'After' }] }, ...(parentId === null ? {} : { parent: parentId }) },
        { id: 'c1', type: 'column', data: {}, parent: 'list', content: ['doomed'] },
        { id: 'doomed', type: 'toggle', data: { text: [] }, parent: 'c1', content: ['deep'] },
        { id: 'deep', type: 'paragraph', data: { text: [] }, parent: 'doomed' },
        { id: 'c2', type: 'column', data: {}, parent: 'list', content: ['a', 'b'] },
        { id: 'a', type: 'toggle', data: { text: [{ text: 'A' }] }, parent: 'c2', content: ['nested'] },
        { id: 'nested', type: 'paragraph', data: { text: [{ text: 'Kept' }] }, parent: 'a' },
        { id: 'b', type: 'paragraph', data: { text: [{ text: 'B' }] }, parent: 'c2' },
      ],
    });

    expect(draft.childrenOf(parentId)).toEqual(['before', 'a', 'b', 'after']);
    expect(draft.get('a')).toMatchObject({ parent: parentId, data: { text: [{ text: 'A' }] } });
    expect(draft.get('b')).toMatchObject({ parent: parentId, data: { text: [{ text: 'B' }] } });
    expect(draft.childrenOf('a')).toEqual(['nested']);
    expect(draft.get('nested')).toMatchObject({ parent: 'a', data: { text: [{ text: 'Kept' }] } });
    expect(draft.get('before')).toMatchObject({ parent: parentId, data: { text: [{ text: 'Before' }] } });
    expect(draft.get('after')).toMatchObject({ parent: parentId, data: { text: [{ text: 'After' }] } });
    if (parentId !== null) {
      expect(draft.childrenOf(null)).toEqual([parentId]);
    }
    for (const id of ['deep', 'doomed', 'c1', 'c2', 'list']) {
      expect(draft.get(id), id).toBeUndefined();
    }
  });
});

const hasMarkDestroyed = (value: unknown): value is { markDestroyed(): void } =>
  typeof value === 'object' && value !== null && 'markDestroyed' in value && typeof value.markDestroyed === 'function';
const hasDestroy = (value: unknown): value is { destroy(): void | Promise<void> } =>
  typeof value === 'object' && value !== null && 'destroy' in value && typeof value.destroy === 'function';
const hasListeners = (value: unknown): value is { listeners: { removeAll(): void } } =>
  typeof value === 'object' && value !== null && 'listeners' in value &&
  typeof value.listeners === 'object' && value.listeners !== null &&
  'removeAll' in value.listeners && typeof value.listeners.removeAll === 'function';

describe('actual browser column runtime wiring', () => {
  let holder: HTMLDivElement | undefined;
  let core: Core | undefined;

  const destroyCore = async (instance: Core): Promise<void> => {
    await instance.isReady.catch(() => undefined);
    const modules: unknown[] = Object.values(instance.moduleInstances);

    modules.filter(hasMarkDestroyed).forEach(module => module.markDestroyed());
    for (const module of modules) {
      if (hasDestroy(module)) {
        await module.destroy();
      }
      if (hasListeners(module)) {
        module.listeners.removeAll();
      }
    }
    destroyTooltip();
  };

  afterEach(async () => {
    try {
      if (core !== undefined) {
        await destroyCore(core);
      }
    } finally {
      core = undefined;
      holder?.remove();
      holder = undefined;
    }
  });

  it('matches shared handlers, descriptions and defaults through real tool adapters', async () => {
    const element = document.createElement('div');

    holder = element;
    document.body.appendChild(element);
    const instance = new Core({
      holder: element, tabSync: false, i18n: { locale: 'en' }, tools: builtInEditorTools(),
    });

    core = instance;
    await instance.isReady;
    const tools = instance.moduleInstances.Tools;
    const browser = runtimesFromTools(tools);
    const snapshot = snapshotFromTools(tools, {
      blokVersion: 'task-38', readOnly: false, defaultBlock: 'paragraph',
      services: [], i18n: instance.moduleInstances.I18n,
    });
    const block = snapshot.blocks.find(block => block.name === 'column_list');
    const built = buildBuiltInSnapshot({ blokVersion: 'task-38' }).blocks.find(block => block.name === 'column_list');

    expect(tools.blockTools.get('column_list')?.toolClass.actionHandlers).toBe(COLUMN_LIST_ACTION_HANDLERS);
    expect(runtimeOf(browser, 'column_list').actions).toBe(COLUMN_LIST_ACTION_HANDLERS);
    expect(runtimeOf(browser, 'column_list').defaultChildren).toEqual(COLUMN_LIST_DEFAULT_CHILDREN);
    expect(runtimeOf(browser, 'column').defaultChildren).toEqual(COLUMN_DEFAULT_CHILDREN);
    expect(block?.handlers.slice().sort()).toEqual(['addColumn', 'create', 'removeColumn', 'setWidths']);
    expect(block?.description?.actions).toEqual(COLUMN_LIST_ACTIONS);
    expect(block).toEqual(built);
    expect(runtimeOf(browser, 'table').normalize).toBe(runtimeOf(BUILT_IN_TOOL_RUNTIMES, 'table').normalize);
    expect(runtimeOf(browser, 'callout').defaultChildren).toBe(runtimeOf(BUILT_IN_TOOL_RUNTIMES, 'callout').defaultChildren);
    expect(runtimeOf(browser, 'table').actions).toEqual(runtimeOf(BUILT_IN_TOOL_RUNTIMES, 'table').actions);
    expect(runtimeOf(browser, 'callout').actions).toEqual(runtimeOf(BUILT_IN_TOOL_RUNTIMES, 'callout').actions);
  }, 60_000);

  it('forwards defaults and real handlers for aliased built-in column classes', async () => {
    const registered = builtInEditorTools();
    const list = registered.column_list;
    const column = registered.column;

    if (list === undefined || column === undefined) {
      throw new Error('Expected canonical column tool registrations.');
    }
    const element = document.createElement('div');

    holder = element;
    document.body.appendChild(element);
    const instance = new Core({
      holder: element, tabSync: false, i18n: { locale: 'en' },
      tools: { ...registered, layout: list, lane: column },
    });

    core = instance;
    await instance.isReady;
    const tools = instance.moduleInstances.Tools;
    const runtimes = runtimesFromTools(tools);
    const snapshot = snapshotFromTools(tools, {
      blokVersion: 'task-38-alias', readOnly: false, defaultBlock: 'paragraph',
      services: [], i18n: instance.moduleInstances.I18n,
    });

    expect(runtimeOf(runtimes, 'layout').defaultChildren).toEqual(COLUMN_LIST_DEFAULT_CHILDREN);
    expect(runtimeOf(runtimes, 'lane').defaultChildren).toEqual(COLUMN_DEFAULT_CHILDREN);
    expect(runtimeOf(runtimes, 'layout').actions).toBe(COLUMN_LIST_ACTION_HANDLERS);
    expect(snapshot.blocks.find(block => block.name === 'layout')?.handlers.sort())
      .toEqual(['addColumn', 'create', 'removeColumn', 'setWidths']);
    const contract = buildAgentContract(buildToolManifest(snapshot), COMMANDS, { runtime: 'editor', services: [] });
    const ctx = plannerContextFrom(contract, runtimes, stubPorts(), validateAgainst, {});
    const { plan, draft } = planOn({ blocks: [] }, [{ name: 'layout.create', args: { count: 2 } }], ctx);
    const result = created(plan.results[0]);

    expect(draft.get(result.id)?.type).toBe('layout');
    expect(draft.childrenOf(result.id)).toEqual(result.childIds);
    expect(result.childIds).toHaveLength(2);
    expect(draft.ids()).toHaveLength(5);
  }, 60_000);
});
