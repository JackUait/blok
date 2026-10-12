import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COMMANDS } from '../../../../src/shared/agent/commands';
import { plannerContextFrom } from '../../../../src/shared/agent/context';
import { buildBuiltInSnapshot } from '../../../../src/shared/built-in-snapshot';
import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { TABS_ACTION_HANDLERS, TABS_DEFAULT_CHILDREN } from '../../../../src/shared/tool-actions/tabs';
import { describeTabs, TABS_ACTIONS } from '../../../../src/shared/tool-descriptions/tabs';
import { buildAgentContract, buildToolManifest } from '../../../../src/shared/tool-manifest';
import { TabsTool } from '../../../../src/tools/tabs';
import { planOn, stubPorts } from '../agent/fixtures';
import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

import type { AgentCommand } from '../../../../types/agent';
import type { OutputData } from '../../../../types/data-formats/output-data';
import type { ToolActionContext, ToolActionDeclaration, ToolActionImpl } from '../../../../types/tools/tool-description';
import type { FakeDoc } from './fake-ctx';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string');

const created = (value: unknown): { id: string; childIds: string[] } => {
  if (!isRecord(value) || typeof value.id !== 'string' || !isStringArray(value.childIds)) {
    throw new Error('Expected a created tabs block and its tab ids.');
  }

  return { id: value.id, childIds: value.childIds };
};

const added = (value: unknown): string => {
  if (!isRecord(value) || typeof value.id !== 'string') {
    throw new Error('Expected a created tab id.');
  }

  return value.id;
};

const readOf = (ctx: ToolActionContext, id: string): NonNullable<ReturnType<ToolActionContext['read']>> => {
  const block = ctx.read(id);

  if (block === null) {
    throw new Error(`Expected block ${id} to exist.`);
  }

  return block;
};

const rootIds = (doc: FakeDoc): string[] => [...doc.values()]
  .filter(block => block.parentId === null)
  .map(block => block.id);

const handlerOf = (name: string): ToolActionImpl => {
  const handler = TABS_ACTION_HANDLERS[name];

  if (handler === undefined) {
    throw new Error(`Missing tabs handler "${name}".`);
  }

  return handler;
};

const actionOf = (name: string): ToolActionDeclaration => {
  const action = TABS_ACTIONS.find(action => action.name === name);

  if (action === undefined) {
    throw new Error(`Missing tabs declaration "${name}".`);
  }

  return action;
};

const threeTabs = (): FakeDoc => docOf([
  { id: 'before', type: 'paragraph', data: { text: [] } },
  { id: 'tabs', type: 'tabs', data: {} },
  { id: 'after', type: 'paragraph', data: { text: [] } },
  { id: 't1', type: 'tab', data: { title: 'One' }, parentId: 'tabs' },
  { id: 'body1', type: 'toggle', data: { text: [] }, parentId: 't1' },
  { id: 'deep1', type: 'paragraph', data: { text: [] }, parentId: 'body1' },
  { id: 't2', type: 'tab', data: { title: 'Two', icon: '🌱' }, parentId: 'tabs' },
  { id: 'body2', type: 'paragraph', data: { text: [] }, parentId: 't2' },
  { id: 't3', type: 'tab', data: { title: 'Three' }, parentId: 'tabs' },
]);

const planBuiltIn = (commands: AgentCommand[], doc: OutputData = { blocks: [] }) => {
  const manifest = buildToolManifest(buildBuiltInSnapshot({ blokVersion: 'task-39' }));
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

describe('tabs create', () => {
  it('creates three default tabs with no bodies', () => {
    const ctx = createFakeCtx(docOf([]), undefined, 'tabs');
    const result = created(handlerOf('create').run(ctx, {}, undefined));

    expect(readOf(ctx, result.id)).toMatchObject({ type: 'tabs', data: {}, parentId: null });
    expect(readOf(ctx, result.id).children).toEqual(result.childIds);
    expect(result.childIds.map(id => readOf(ctx, id).data)).toEqual([{ title: 'Tab 1' }, { title: 'Tab 2' }, { title: 'Tab 3' }]);
    expect(result.childIds.map(id => readOf(ctx, id).children)).toEqual([[], [], []]);
    expect(ctx.doc.size).toBe(4);
  });

  it('creates the given tabs in order and keeps an icon only where given', () => {
    const ctx = createFakeCtx(docOf([]), undefined, 'tabs');
    const result = created(handlerOf('create').run(ctx, { tabs: [{ title: 'Plan' }, { title: 'Done', icon: '✅' }] }, undefined));

    expect(result.childIds.map(id => readOf(ctx, id))).toEqual([
      { id: result.childIds[0], type: 'tab', data: { title: 'Plan' }, parentId: result.id, children: [] },
      { id: result.childIds[1], type: 'tab', data: { title: 'Done', icon: '✅' }, parentId: result.id, children: [] },
    ]);
  });

  it('uses the configured registry key for the tabs block', () => {
    const ctx = createFakeCtx(docOf([]), undefined, 'sections');
    const result = created(handlerOf('create').run(ctx, {}, undefined));

    expect(readOf(ctx, result.id).type).toBe('sections');
    expect(result.childIds.map(id => readOf(ctx, id).type)).toEqual(['tab', 'tab', 'tab']);
  });

  it('places the block at the requested parent and position', () => {
    const ctx = createFakeCtx(docOf([
      { id: 'p', type: 'callout', data: {} },
      { id: 'b', type: 'paragraph', data: { text: [] }, parentId: 'p' },
    ]), undefined, 'tabs');
    const result = created(handlerOf('create').run(ctx, { parentId: 'p', position: { before: 'b' } }, undefined));

    expect(readOf(ctx, 'p').children).toEqual([result.id, 'b']);
    expect(rootIds(ctx.doc)).toEqual(['p']);
  });

  it('refuses an empty tab list without recording writes', () => {
    const ctx = createFakeCtx(docOf([]), undefined, 'tabs');

    expect(() => handlerOf('create').run(ctx, { tabs: [] }, undefined)).toThrow(FakeFailure);
    expect(ctx.edits).toEqual([]);
  });
});

describe('tabs addTab', () => {
  it.each([
    { at: 0, order: ['new', 't1', 't2', 't3'] },
    { at: 2, order: ['t1', 't2', 'new', 't3'] },
    { at: 3, order: ['t1', 't2', 't3', 'new'] },
    { at: 9, order: ['t1', 't2', 't3', 'new'] },
    { at: undefined, order: ['t1', 't2', 't3', 'new'] },
  ])('inserts a tab at $at with the next default title', ({ at, order }) => {
    const ctx = createFakeCtx(threeTabs(), 'tabs');
    const id = added(handlerOf('addTab').run(ctx, at === undefined ? {} : { at }, undefined));

    expect(readOf(ctx, 'tabs').children).toEqual(order.map(tab => tab === 'new' ? id : tab));
    expect(readOf(ctx, id)).toEqual({ id, type: 'tab', data: { title: 'Tab 4' }, parentId: 'tabs', children: [] });
    expect(rootIds(ctx.doc)).toEqual(['before', 'tabs', 'after']);
  });

  it('writes the given title and icon', () => {
    const ctx = createFakeCtx(threeTabs(), 'tabs');
    const id = added(handlerOf('addTab').run(ctx, { title: 'Notes', icon: '📝' }, undefined));

    expect(readOf(ctx, id).data).toEqual({ title: 'Notes', icon: '📝' });
  });

  it('counts only tab children for the default title and the index', () => {
    const ctx = createFakeCtx(docOf([
      { id: 'tabs', type: 'tabs', data: {} },
      { id: 'stray', type: 'paragraph', data: { text: [] }, parentId: 'tabs' },
      { id: 't1', type: 'tab', data: { title: 'One' }, parentId: 'tabs' },
    ]), 'tabs');
    const id = added(handlerOf('addTab').run(ctx, { at: 1 }, undefined));

    expect(readOf(ctx, id).data).toMatchObject({ title: 'Tab 2' });
    expect(readOf(ctx, 'tabs').children).toEqual(['stray', 't1', id]);
  });
});

describe('tabs deleteTab', () => {
  it('removes the tab with its content and keeps the others', () => {
    const ctx = createFakeCtx(threeTabs(), 'tabs');

    handlerOf('deleteTab').run(ctx, { tabId: 't1' }, undefined);

    expect(readOf(ctx, 'tabs').children).toEqual(['t2', 't3']);
    for (const id of ['t1', 'body1', 'deep1']) {
      expect(ctx.read(id), id).toBeNull();
    }
    expect(readOf(ctx, 't2').children).toEqual(['body2']);
    expect(rootIds(ctx.doc)).toEqual(['before', 'tabs', 'after']);
  });

  it('deleting the last tab deletes the tabs block and its content', () => {
    const ctx = createFakeCtx(docOf([
      { id: 'before', type: 'paragraph', data: { text: [] } },
      { id: 'tabs', type: 'tabs', data: {} },
      { id: 'only', type: 'tab', data: { title: 'Only' }, parentId: 'tabs' },
      { id: 'body', type: 'paragraph', data: { text: [] }, parentId: 'only' },
    ]), 'tabs');

    handlerOf('deleteTab').run(ctx, { tabId: 'only' }, undefined);

    for (const id of ['tabs', 'only', 'body']) {
      expect(ctx.read(id), id).toBeNull();
    }
    expect(rootIds(ctx.doc)).toEqual(['before']);
  });

  it.each(['missing', 'body1', 'before'])('refuses %s, which is not a tab of this block, without writes', tabId => {
    const ctx = createFakeCtx(threeTabs(), 'tabs');

    expect(() => handlerOf('deleteTab').run(ctx, { tabId }, undefined)).toThrow(FakeFailure);
    expect(ctx.edits).toEqual([]);
  });
});

describe('tabs declarations and shared runtime', () => {
  it('declares exactly the three implemented actions', () => {
    expect(TABS_ACTIONS.map(action => [action.name, action.target])).toEqual([
      ['create', 'create'], ['addTab', 'block'], ['deleteTab', 'block'],
    ]);
    expect(describeTabs().actions).toBe(TABS_ACTIONS);
    expect(Object.keys(TABS_ACTION_HANDLERS).sort()).toEqual(TABS_ACTIONS.map(action => action.name).sort());
    expect(BUILT_IN_TOOL_RUNTIMES.get('tabs')?.actions).toBe(TABS_ACTION_HANDLERS);
    expect(TabsTool.actionHandlers).toBe(TABS_ACTION_HANDLERS);
  });

  it.each([
    { name: 'create', args: {} },
    { name: 'create', args: { tabs: [{ title: 'A' }, { title: 'B', icon: '🌱' }] } },
    { name: 'addTab', args: {} },
    { name: 'addTab', args: { title: 'A', icon: '🌱', at: 0 } },
    { name: 'deleteTab', args: { tabId: 't1' } },
  ])('accepts $name arguments $args', ({ name, args }) => {
    expect(validateAgainst(actionOf(name).args, args)).toEqual([]);
  });

  it.each([
    { name: 'create', args: { tabs: [] } },
    { name: 'create', args: { tabs: [{}] } },
    { name: 'create', args: { tabs: [{ title: 'A', color: 'red' }] } },
    { name: 'addTab', args: { at: -1 } },
    { name: 'addTab', args: { at: 0.5 } },
    { name: 'addTab', args: { title: 3 } },
    { name: 'deleteTab', args: {} },
  ])('rejects $name arguments $args', ({ name, args }) => {
    expect(validateAgainst(actionOf(name).args, args).length).toBeGreaterThan(0);
  });

  it('registers three default tabs with no bodies', () => {
    expect(TABS_DEFAULT_CHILDREN).toEqual([
      { type: 'tab', data: { title: 'Tab 1' } },
      { type: 'tab', data: { title: 'Tab 2' } },
      { type: 'tab', data: { title: 'Tab 3' } },
    ]);
    expect(BUILT_IN_TOOL_RUNTIMES.get('tabs')?.defaultChildren).toBe(TABS_DEFAULT_CHILDREN);
  });

  it('publishes the handlers in the built-in snapshot and contract', () => {
    const snapshot = buildBuiltInSnapshot({ blokVersion: 'task-39' });
    const contract = buildAgentContract(buildToolManifest(snapshot), COMMANDS, { runtime: 'node', services: [] });

    expect(snapshot.blocks.find(block => block.name === 'tabs')?.handlers.slice().sort()).toEqual(['addTab', 'create', 'deleteTab']);
    expect(contract.commands.filter(command => command.name.startsWith('tabs.'))
      .map(command => ({ name: command.name, available: command.available, source: command.source }))).toEqual([
      { name: 'tabs.addTab', available: true, source: { tool: 'tabs', target: 'block' } },
      { name: 'tabs.create', available: true, source: { tool: 'tabs', target: 'create' } },
      { name: 'tabs.deleteTab', available: true, source: { tool: 'tabs', target: 'block' } },
    ]);
  });
});

describe('real shared planner', () => {
  it('seeds a generic tabs insert with three tabs exactly once', () => {
    const { plan, draft } = planBuiltIn([{ name: 'block.insert', args: { type: 'tabs' }, ref: 'tabs' }]);
    const id = plan.refs.tabs;

    if (id === undefined) {
      throw new Error('Expected the inserted tabs ref.');
    }

    expect(draft.childrenOf(id).map(tab => draft.get(tab)?.data)).toEqual([{ title: 'Tab 1' }, { title: 'Tab 2' }, { title: 'Tab 3' }]);
    expect(draft.ids()).toHaveLength(4);
  });

  it('does not add default tabs before tabs.create adds its own', () => {
    const { plan, draft } = planBuiltIn([{ name: 'tabs.create', args: { tabs: [{ title: 'Only' }] } }]);
    const result = created(plan.results[0]);

    expect(draft.childrenOf(result.id)).toEqual(result.childIds);
    expect(result.childIds.map(id => draft.get(id)?.data)).toEqual([{ title: 'Only' }]);
    expect(draft.ids()).toHaveLength(2);
  });

  it('deleting the last tab through the planner removes the whole subtree', () => {
    const { draft } = planBuiltIn([{ name: 'tabs.deleteTab', args: { id: 'tabs', tabId: 'only' } }], {
      blocks: [
        { id: 'tabs', type: 'tabs', data: {}, content: ['only'] },
        { id: 'only', type: 'tab', data: { title: 'Only' }, parent: 'tabs', content: ['body'] },
        { id: 'body', type: 'paragraph', data: { text: [] }, parent: 'only' },
      ],
    });

    expect(draft.ids()).toEqual([]);
  });
});
