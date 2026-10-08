// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentFailure } from '../../../../src/shared/agent/errors';
import { looksLikeMarkdown } from '../../../../src/shared/agent/markdown-lookalike';
import { buildPlannedBlock } from '../../../../src/shared/agent/plan-block';
import { HANDLERS, planBatch, registerHandlers } from '../../../../src/shared/agent/planner';
import { PlanState } from '../../../../src/shared/agent/plan-state';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';
import { coreCommandMap, plannerContext, stubPorts, TOOLS, tool } from './fixtures';

import type { CommandHandler } from '../../../../src/shared/agent/planner';
import type { PlannerContext } from '../../../../src/shared/agent/types';
import type { AgentWarning, Edit, OutputData } from '../../../../types';

const doc: OutputData = { blocks: [
  { id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } },
  { id: 'tg', type: 'toggle', data: {}, content: ['a', 'b'] },
  { id: 'a', type: 'toggle', data: {}, parent: 'tg', content: ['leaf'] },
  { id: 'leaf', type: 'paragraph', data: { text: [] }, parent: 'a' },
  { id: 'b', type: 'paragraph', data: { text: [] }, parent: 'tg' },
  { id: 'end', type: 'paragraph', data: { text: [] } },
] };

const stateOn = (over: Partial<PlannerContext> = {}): PlanState =>
  new PlanState(DocSnapshot.fromOutput(doc), plannerContext(over), [], { actorId: 'agent', at: 1 });

const failOf = (fn: () => unknown): AgentFailure['error'] => {
  try {
    fn();
  } catch (error) {
    if (error instanceof AgentFailure) {
      return error.error;
    }
    throw error;
  }
  throw new Error('Expected an AgentFailure');
};

let originalHandlers: Record<string, CommandHandler> = {};

describe('PlanState and planner dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    originalHandlers = { ...HANDLERS };
  });

  afterEach(() => {
    for (const name of Object.keys(HANDLERS)) {
      Reflect.deleteProperty(HANDLERS, name);
    }
    Object.assign(HANDLERS, originalHandlers);
    vi.restoreAllMocks();
  });

  it.each([
    { label: 'root start', parent: undefined, position: 'start', expected: { parentId: null, afterId: null } },
    { label: 'root end', parent: null, position: 'end', expected: { parentId: null, afterId: 'end' } },
    { label: 'child end', parent: 'tg', position: 'end', expected: { parentId: 'tg', afterId: 'b' } },
    { label: 'inferred child before', parent: undefined, position: { before: 'b' }, expected: { parentId: 'tg', afterId: 'a' } },
    { label: 'first child before', parent: 'tg', position: { before: 'a' }, expected: { parentId: 'tg', afterId: null } },
    { label: 'inferred child after', parent: undefined, position: { after: 'a' }, expected: { parentId: 'tg', afterId: 'a' } },
    { label: 'empty child container', parent: 'b', position: 'end', expected: { parentId: 'b', afterId: null } },
  ])('resolves $label into an exact insertion slot', ({ parent, position, expected }) => {
    expect(stateOn().place(parent, position)).toEqual(expected);
  });

  it('refuses a sibling anchor outside the requested parent', () => {
    const state = stateOn();
    state.index = 2;

    expect(failOf(() => state.place('tg', { after: 'p' }))).toMatchObject({
      code: 'PLACEMENT_REFUSED', commandIndex: 2, path: '/commands/2/args/position',
      details: { reason: 'NOT_A_CHILD' },
    });
  });

  it('refuses an unknown sibling anchor rather than silently choosing a slot', () => {
    expect(failOf(() => stateOn().place(undefined, { before: 'missing' }))).toMatchObject({
      code: 'BLOCK_NOT_FOUND', path: '/commands/0/args/position/before', details: { id: 'missing' },
    });
  });

  it.each([
    { label: 'empty ID', value: '' },
    { label: 'numeric ID', value: 2 },
    { label: 'null ID', value: null },
  ])('refuses $label at the caller pointer', ({ value }) => {
    const state = stateOn();
    state.index = 3;

    expect(failOf(() => state.resolveId(value, '/id'))).toMatchObject({
      code: 'INVALID_ARGS', commandIndex: 3, path: '/commands/3/args/id',
    });
  });

  it('requires the referenced block to still exist after a prior removal', () => {
    const state = stateOn();
    state.refs.gone = 'p';
    state.emit({ op: 'remove', id: 'p', withChildren: true });
    state.index = 1;

    expect(failOf(() => state.requireBlock('$gone', '/id'))).toMatchObject({
      code: 'BLOCK_NOT_FOUND', commandIndex: 1, path: '/commands/1/args/id',
    });
  });

  it('lists only a tool’s declared actions in sorted order', () => {
    const commands = coreCommandMap();
    commands.set('toggle.zeta', {
      name: 'toggle.zeta', args: {}, readOnly: false, available: true,
      source: { tool: 'toggle', target: 'block' },
    });
    commands.set('toggle.alpha', {
      name: 'toggle.alpha', args: {}, readOnly: false, available: false,
      source: { tool: 'toggle', target: 'create' },
    });

    expect(stateOn({ commands }).actionsOf('toggle')).toEqual(['toggle.alpha', 'toggle.zeta']);
  });

  it('sanitizes a partial patch without normalizing it when the caller opts out', () => {
    const normalize = vi.fn((data: Record<string, unknown>) => ({ ...data, added: true }));
    const sanitizeBlockData = vi.fn((_type: string, data: Record<string, unknown>) => ({ ...data, url: 'clean' }));
    const tools = new Map(TOOLS);
    tools.set('image', tool('image', {}, { normalize }));
    const state = stateOn({ tools, ports: stubPorts({ sanitizeBlockData }) });

    expect(state.prepareData('image', { url: 'dirty' }, '/data', 'img', { normalize: false })).toEqual({ url: 'clean' });
    expect(normalize).not.toHaveBeenCalled();
    expect(state.warnings).toEqual([expect.objectContaining({
      code: 'SANITIZED', blockId: 'img', field: 'url', commandIndex: 0,
    })]);
  });

  it('refuses a non-string, non-array rich field with a typed error', () => {
    const state = stateOn();
    state.index = 2;

    expect(failOf(() => state.prepareData('paragraph', { text: 3 }, '/data', 'p'))).toMatchObject({
      code: 'INVALID_ARGS', commandIndex: 2, path: '/commands/2/args/data/text',
    });
  });

  it('records the exact command index for every emitted edit', () => {
    const state = stateOn();
    state.index = 2;
    state.emit(
      { op: 'setData', id: 'p', patch: { label: 'first' } },
      { op: 'setTunes', id: 'p', tunes: { align: 'left' } }
    );
    state.index = 4;
    state.emit({ op: 'setRichText', id: 'p', field: 'text', value: [{ text: 'last' }] });

    expect(state.editCommand).toEqual([2, 2, 4]);
    expect(state.edits).toEqual([
      { op: 'setData', id: 'p', patch: { label: 'first' } },
      { op: 'setTunes', id: 'p', tunes: { align: 'left' } },
      { op: 'setRichText', id: 'p', field: 'text', value: [{ text: 'last' }] },
    ]);
    expect(state.draft.get('p')?.data).toEqual({ text: [{ text: 'last' }], label: 'first' });
  });

  it('keeps write payloads in edit order through a later retype and removal', () => {
    const state = stateOn();
    state.emit({ op: 'setData', id: 'p', patch: { label: 'old-type-write' } });
    state.index = 1;
    state.emit({ op: 'replaceType', id: 'p', type: 'image', data: { url: 'image.png' } });
    state.index = 2;
    state.emit({ op: 'remove', id: 'p', withChildren: true });

    expect(state.edits).toEqual([
      { op: 'setData', id: 'p', patch: { label: 'old-type-write' } },
      { op: 'replaceType', id: 'p', type: 'image', data: { url: 'image.png' } },
      { op: 'remove', id: 'p', withChildren: true },
    ]);
    expect(state.editCommand).toEqual([0, 1, 2]);
    expect(state.draft.has('p')).toBe(false);
  });

  it.each([
    { label: 'empty data patch', edit: { op: 'setData', id: 'p', patch: {} } },
    { label: 'value-equal rich text', edit: { op: 'setRichText', id: 'p', field: 'text', value: [{ text: 'P' }] } },
    { label: 'empty tune patch', edit: { op: 'setTunes', id: 'p', tunes: {} } },
    { label: 'value-equal retype', edit: { op: 'replaceType', id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } } },
  ] satisfies Array<{ label: string; edit: Edit }>)('counts an emitted $label as a touched content write', ({ edit }) => {
    const state = stateOn();
    state.emit(edit);

    expect([...state.touched]).toEqual(['p']);
    expect(state.changed.updated).toEqual(['p']);
    expect(state.edits).toEqual([edit]);
    expect(state.editCommand).toEqual([0]);
  });

  it('touches the moved block but not descendants or either parent', () => {
    const state = stateOn();
    state.emit({ op: 'move', id: 'a', parentId: null, afterId: 'end' });

    expect([...state.touched]).toEqual(['a']);
    expect(state.changed.moved).toEqual(['a']);
    expect(state.draft.childrenOf(null)).toEqual(['p', 'tg', 'end', 'a']);
    expect(state.draft.childrenOf('a')).toEqual(['leaf']);
  });

  it('touches directly lifted children but not carried descendants or the removed parent', () => {
    const state = stateOn();
    state.emit({ op: 'remove', id: 'tg', withChildren: false });

    expect([...state.touched]).toEqual(['a', 'b']);
    expect(state.changed.moved).toEqual(['a', 'b']);
    expect(state.changed.removed).toEqual(['tg']);
    expect(state.draft.childrenOf(null)).toEqual(['p', 'a', 'b', 'end']);
    expect(state.draft.parentOf('leaf')).toBe('a');
  });

  it('does not touch deleted blocks for a subtree removal', () => {
    const state = stateOn();
    state.emit({ op: 'remove', id: 'tg', withChildren: true });

    expect([...state.touched]).toEqual([]);
    expect(state.changed.removed).toEqual(['tg', 'a', 'leaf', 'b']);
    expect(state.changed.moved).toEqual([]);
  });

  it('does not touch a block for a page-field edit', () => {
    const state = stateOn();
    state.emit({ op: 'setPageField', key: 'title', value: 'Title' });

    expect([...state.touched]).toEqual([]);
    expect(state.changed).toEqual({ created: [], updated: [], moved: [], removed: [] });
    expect(state.draft.toOutput().title).toBe('Title');
    expect(state.editCommand).toEqual([0]);
  });

  it('registers a handler, dispatches its arguments, and rejects a ref when it creates no block', () => {
    registerHandlers({ 'scratch.echo': (_state, args) => ({ echo: args.value }) });
    const commands = coreCommandMap();
    commands.set('scratch.echo', {
      name: 'scratch.echo', args: { type: 'object' }, readOnly: true, available: true, source: 'core',
    });
    const input = {
      snapshot: DocSnapshot.fromOutput(doc), ctx: plannerContext({ commands }),
      stamp: { actorId: 'agent', at: 1 }, warnings: [],
    };
    const { plan } = planBatch({
      ...input, batch: { commands: [{ name: 'scratch.echo', args: { value: 'kept' } }] },
    });

    expect(plan.results).toEqual([{ echo: 'kept' }]);
    expect(failOf(() => planBatch({
      ...input, batch: { commands: [{ name: 'scratch.echo', args: {}, ref: 'notCreated' }] },
    }))).toMatchObject({ code: 'INVALID_ARGS', commandIndex: 0, path: '/commands/0/ref' });
  });

  it('returns UNKNOWN_COMMAND for a command without a planner handler', () => {
    expect(failOf(() => planBatch({
      snapshot: DocSnapshot.fromOutput(doc),
      batch: { commands: [{ name: 'scratch.missing', args: {} }] },
      ctx: plannerContext(), stamp: { actorId: 'agent', at: 1 }, warnings: [],
    }))).toMatchObject({ code: 'UNKNOWN_COMMAND', commandIndex: 0, path: '/commands/0/name' });
  });

  it('deduplicates changed kinds with removed and created precedence', () => {
    registerHandlers({ 'scratch.sequence': state => {
      state.emit(
        { op: 'insert', parentId: null, afterId: 'end', block: { id: 'new', type: 'paragraph', data: {}, children: [] } },
        { op: 'setData', id: 'new', patch: { label: 'new' } },
        { op: 'move', id: 'new', parentId: null, afterId: null },
        { op: 'insert', parentId: null, afterId: 'new', block: { id: 'temporary', type: 'paragraph', data: {}, children: [] } },
        { op: 'remove', id: 'temporary', withChildren: true },
        { op: 'setData', id: 'p', patch: { label: 'first' } },
        { op: 'setData', id: 'p', patch: { label: 'last' } },
        { op: 'setData', id: 'b', patch: { label: 'gone' } },
        { op: 'remove', id: 'b', withChildren: true },
        { op: 'move', id: 'a', parentId: null, afterId: 'end' },
        { op: 'move', id: 'a', parentId: null, afterId: 'p' }
      );

      return {};
    } });
    const commands = coreCommandMap();
    commands.set('scratch.sequence', {
      name: 'scratch.sequence', args: { type: 'object' }, readOnly: false, available: true, source: 'core',
    });
    const warnings: AgentWarning[] = [];
    const { plan } = planBatch({
      snapshot: DocSnapshot.fromOutput(doc),
      batch: { commands: [{ name: 'scratch.sequence', args: {} }] },
      ctx: plannerContext({ commands }), stamp: { actorId: 'agent', at: 1 }, warnings,
    });

    expect(plan.changed).toEqual({
      created: ['new'], updated: ['p'], moved: ['a'], removed: ['temporary', 'b'],
    });
    expect(plan.warnings).toBe(warnings);
  });

  it('recognizes the documented Markdown look-alike syntax', () => {
    const values = ['**bold**', '__bold__', '# heading', '- item', '* item', '+ item', '1. item', '[a](b)', '`code`', 'plain\n- item'];

    expect(values.map(looksLikeMarkdown)).toEqual(values.map(() => true));
  });

  it('does not flag ordinary text or incomplete Markdown syntax', () => {
    const values = ['ordinary text', 'a*b', 'a_b', '#not-a-heading', '1 item', '-'];

    expect(values.map(looksLikeMarkdown)).toEqual(values.map(() => false));
  });

  it('keeps the create-action insert restriction out of the reusable block builder', () => {
    const commands = coreCommandMap();
    commands.set('table.create', {
      name: 'table.create', args: { type: 'object' }, readOnly: false,
      available: true, source: { tool: 'table', target: 'create' },
    });
    const state = stateOn({ commands });
    const planned = buildPlannedBlock(state, { type: 'table', id: 'copy' }, { id: null }, '', false);

    expect(planned).toEqual({ id: 'copy', type: 'table', data: {}, children: [] });
    expect(state.edits).toEqual([]);
    expect(state.draft.has('copy')).toBe(false);
  });
});

describe('PlanState controlling corrections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    { ref: 'constructor' },
    { ref: 'toString' },
    { ref: '__proto__' },
  ])('refuses a deleted $ref own ref through requireBlock', ({ ref }) => {
    const state = stateOn();
    Object.defineProperty(state.refs, ref, {
      value: 'p', writable: true, enumerable: true, configurable: true,
    });
    state.emit({ op: 'remove', id: 'p', withChildren: true });
    state.index = 1;

    expect(failOf(() => state.requireBlock(`$${ref}`, '/id'))).toMatchObject({
      code: 'BLOCK_NOT_FOUND', commandIndex: 1, path: '/commands/1/args/id',
    });
  });

  it('keeps mapped self-placed trees available to the reusable block builder', () => {
    const state = stateOn();
    const planned = buildPlannedBlock(state, {
      type: 'table', id: 'copy', data: { content: [[{ blocks: ['cell'] }]] },
      children: [{ type: 'paragraph', id: 'cell', data: { text: 'mapped' } }],
    }, { id: null }, '', false);

    expect(planned.children).toEqual([{
      id: 'cell', type: 'paragraph', data: { text: [{ text: 'mapped' }] }, children: [],
    }]);
    expect(planned.data).toEqual({ content: [[{ blocks: ['cell'] }]] });
    expect(state.edits).toEqual([]);
    expect(state.draft.has('cell')).toBe(false);
  });
});

describe('creation-only result refs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    originalHandlers = { ...HANDLERS };
  });

  afterEach(() => {
    for (const name of Object.keys(HANDLERS)) {
      Reflect.deleteProperty(HANDLERS, name);
    }
    Object.assign(HANDLERS, originalHandlers);
    vi.restoreAllMocks();
  });

  it('refuses an explicit ref when a non-creating handler returns an existing block ID', () => {
    registerHandlers({ 'scratch.existing': () => ({ id: 'p' }) });
    const commands = coreCommandMap();
    commands.set('scratch.existing', {
      name: 'scratch.existing', args: { type: 'object' }, readOnly: true,
      available: true, source: 'core',
    });

    expect(failOf(() => planBatch({
      snapshot: DocSnapshot.fromOutput(doc),
      batch: { commands: [{ name: 'scratch.existing', args: {}, ref: 'existing' }] },
      ctx: plannerContext({ commands }), stamp: { actorId: 'agent', at: 1 }, warnings: [],
    }))).toMatchObject({ code: 'INVALID_ARGS', commandIndex: 0, path: '/commands/0/ref' });
  });
});

describe('T8-R1 explicit descendant ID reservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reserves explicit descendant IDs before allocating an anonymous reusable-builder parent', () => {
    const state = stateOn();
    const planned = buildPlannedBlock(state, {
      type: 'toggle', children: [{ type: 'paragraph', id: 'n1' }],
    }, { id: null }, '', false);

    expect({ id: planned.id, childIds: planned.children.map(child => child.id) }).toEqual({
      id: 'n2', childIds: ['n1'],
    });
  });
});
