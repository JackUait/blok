// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentFailure } from '../../../../src/shared/agent/errors';
import { planBatch } from '../../../../src/shared/agent/planner';
import { PREPARE_PENDING } from '../../../../src/shared/agent/plan-state';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';
import { coreCommandMap, plannerContext, planOn, stubPorts, TOOLS, tool } from './fixtures';

import type { PlannerCommand } from '../../../../src/shared/agent/types';
import type { AgentCommand, AgentWarning, OutputData } from '../../../../types';

const doc: OutputData = { blocks: [
  { id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] }, lastEditedBy: 'human', lastEditedAt: 8 },
  { id: 'tg', type: 'toggle', data: { text: [] } },
  { id: 'tbl', type: 'table', data: { content: [] } },
] };

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

const createOf = (name: string): PlannerCommand => ({
  name: `${name}.create`,
  args: { type: 'object' },
  readOnly: false,
  available: true,
  source: { tool: name, target: 'create' },
});

describe('block.insert planning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('inserts after a sibling and treats an HTML-looking string as literal text', () => {
    const htmlToSegments = vi.fn(() => [{ text: 'parsed' }]);
    const { plan, draft } = planOn(doc, [{
      name: 'block.insert',
      args: { type: 'paragraph', data: { text: '<b>x</b>' }, position: { after: 'p' } },
    }], { ports: stubPorts({ htmlToSegments }) });

    expect(draft.get('n1')?.data.text).toEqual([{ text: '<b>x</b>' }]);
    expect(plan.results).toEqual([{ id: 'n1', childIds: [] }]);
    expect(draft.childrenOf(null)).toEqual(['p', 'n1', 'tg', 'tbl']);
    expect(plan.changed).toEqual({ created: ['n1'], updated: [], moved: [], removed: [] });
    expect([...plan.touched]).toEqual(['n1']);
    expect(htmlToSegments).not.toHaveBeenCalled();
  });

  it('plans on a clone without changing the source snapshot, batch, tunes or nested data', () => {
    const snapshot = DocSnapshot.fromOutput(doc);
    const before = snapshot.toOutput();
    const commands: AgentCommand[] = [{
      name: 'block.insert',
      args: { type: 'image', id: 'img', data: { url: 'image.png', meta: { label: 'kept' } }, tunes: { align: { side: 'left' } } },
    }];
    const batchBefore = structuredClone(commands);
    const { draft } = planBatch({
      snapshot, batch: { commands }, ctx: plannerContext(),
      stamp: { actorId: 'agent', at: 1 }, warnings: [],
    });

    expect(snapshot.toOutput()).toEqual(before);
    expect(commands).toEqual(batchBefore);
    expect(draft.get('img')?.data).toEqual({ url: 'image.png', meta: { label: 'kept' } });
    expect(draft.get('img')?.tunes).toEqual({ align: { side: 'left' } });
    expect(draft.get('img')?.rest).toMatchObject({ lastEditedBy: 'agent', lastEditedAt: 1 });
    expect(draft.get('p')?.rest).toMatchObject({ lastEditedBy: 'human', lastEditedAt: 8 });
  });

  it('uses explicit children instead of seeding defaults', () => {
    const { plan, draft } = planOn(doc, [{
      name: 'block.insert', args: { type: 'column_list', children: [{ type: 'column' }] },
    }]);

    expect(draft.childrenOf('n1')).toEqual(['n2']);
    expect(plan.results).toEqual([{ id: 'n1', childIds: ['n2'] }]);
    expect(plan.changed.created).toEqual(['n1', 'n2']);
  });

  it('uses explicit empty children instead of seeding defaults', () => {
    const { draft } = planOn(doc, [{ name: 'block.insert', args: { type: 'column_list', children: [] } }]);

    expect(draft.childrenOf('n1')).toEqual([]);
    expect(draft.ids()).toEqual(['p', 'tg', 'tbl', 'n1']);
  });

  it('seeds omitted children and preserves their order', () => {
    const { plan, draft } = planOn(doc, [{ name: 'block.insert', args: { type: 'column_list' } }]);

    expect(draft.childrenOf('n1')).toEqual(['n2', 'n3']);
    expect(plan.results).toEqual([{ id: 'n1', childIds: ['n2', 'n3'] }]);
    expect(plan.changed.created).toEqual(['n1', 'n2', 'n3']);
  });

  it('returns direct child IDs while creating and touching the full nested tree', () => {
    const { plan, draft } = planOn(doc, [{
      name: 'block.insert', args: {
        type: 'toggle', id: 'outer', children: [{
          type: 'toggle', id: 'inner', children: [{ type: 'paragraph', id: 'leaf', data: { text: 'L' } }],
        }],
      },
    }]);

    expect(plan.results).toEqual([{ id: 'outer', childIds: ['inner'] }]);
    expect(plan.changed.created).toEqual(['outer', 'inner', 'leaf']);
    expect([...plan.touched]).toEqual(['outer', 'inner', 'leaf']);
    expect(draft.childrenOf('inner')).toEqual(['leaf']);
    expect(draft.get('leaf')?.data.text).toEqual([{ text: 'L' }]);
    expect(draft.get('leaf')?.rest).toMatchObject({ lastEditedBy: 'agent', lastEditedAt: 1 });
  });

  it('refuses an unresolved ref before checking container rules', () => {
    expect(failOf(() => planOn(doc, [{
      name: 'block.insert', args: { type: 'paragraph', parentId: '$cl' },
    }]))).toMatchObject({
      code: 'BLOCK_NOT_FOUND', commandIndex: 0, path: '/commands/0/args/parentId', details: { ref: 'cl' },
    });
  });

  it('refuses a disallowed child and names allowed tools', () => {
    expect(failOf(() => planOn(doc, [
      { name: 'block.insert', args: { type: 'column_list', children: [{ type: 'column' }] }, ref: 'cl' },
      { name: 'block.insert', args: { type: 'paragraph', parentId: '$cl' } },
    ]))).toMatchObject({
      code: 'PLACEMENT_REFUSED', commandIndex: 1,
      details: { reason: 'CHILD_NOT_ALLOWED', allowed: ['column'] },
    });
  });

  it('refuses children of an existing leaf', () => {
    const source: OutputData = { blocks: [{ id: 'd', type: 'divider', data: {} }] };

    expect(failOf(() => planOn(source, [{
      name: 'block.insert', args: { type: 'paragraph', parentId: 'd', demote: true },
    }]))).toMatchObject({ code: 'PLACEMENT_REFUSED', details: { reason: 'TAKES_NO_CHILDREN' } });
  });

  it('applies child restrictions to a newly planned container', () => {
    expect(failOf(() => planOn(doc, [{
      name: 'block.insert', args: { type: 'column_list', children: [{ type: 'paragraph' }] },
    }]))).toMatchObject({
      code: 'PLACEMENT_REFUSED', path: '/commands/0/args/children/0/type',
      details: { reason: 'CHILD_NOT_ALLOWED', allowed: ['column'] },
    });
  });

  it('demotes a denied child to the configured default and warns', () => {
    const { draft, warnings } = planOn(doc, [{
      name: 'block.insert', args: { type: 'table', parentId: 'tg', demote: true },
    }]);

    expect(draft.get('n1')?.type).toBe('paragraph');
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'DEMOTED', commandIndex: 0 }));
  });

  it('demotes to the first allowed type rather than the default block', () => {
    const { draft } = planOn(doc, [
      { name: 'block.insert', args: { type: 'column_list', id: 'cl', children: [] } },
      { name: 'block.insert', args: { type: 'paragraph', parentId: 'cl', demote: true } },
    ]);

    expect(draft.get('n1')?.type).toBe('column');
    expect(draft.childrenOf('cl')).toEqual(['n1']);
  });

  it('refuses an unknown tool', () => {
    expect(failOf(() => planOn(doc, [{ name: 'block.insert', args: { type: 'kanban' } }]))).toMatchObject({
      code: 'UNKNOWN_TOOL', commandIndex: 0, path: '/commands/0/args/type',
    });
  });

  it('refuses a self-placed parent and supplies its action names', () => {
    const commands = coreCommandMap();
    commands.set('table.create', createOf('table'));
    commands.set('table.insertIntoCell', {
      name: 'table.insertIntoCell', args: { type: 'object' }, readOnly: false,
      available: true, source: { tool: 'table', target: 'block' },
    });

    expect(failOf(() => planOn(doc, [{
      name: 'block.insert', args: { type: 'paragraph', parentId: 'tbl' },
    }], { commands }))).toMatchObject({
      code: 'PLACEMENT_REFUSED', details: {
        reason: 'SELF_PLACED_PARENT', use: ['table.create', 'table.insertIntoCell'],
      },
    });
  });

  it('refuses restricted tools inside a table cell descendant', () => {
    const source: OutputData = { blocks: [
      { id: 'table', type: 'table', data: { content: [[{ blocks: ['cell'] }]] }, content: ['cell'] },
      { id: 'cell', type: 'toggle', data: {}, parent: 'table', content: ['deep'] },
      { id: 'deep', type: 'toggle', data: {}, parent: 'cell' },
    ] };

    expect(failOf(() => planOn(source, [{
      name: 'block.insert', args: { type: 'header', parentId: 'deep' },
    }]))).toMatchObject({ code: 'PLACEMENT_REFUSED', details: { reason: 'RESTRICTED_IN_CELL' } });
  });

  it('reports only sanitizer-changed fields after rich-text conversion', () => {
    const sanitizeBlockData = vi.fn((_type: string, data: Record<string, unknown>) => ({
      ...data, text: [{ text: 'clean' }],
    }));
    const { warnings, draft } = planOn(doc, [{
      name: 'block.insert', args: { type: 'paragraph', data: { text: 'dirty', label: 'keep' } },
    }], { ports: stubPorts({ sanitizeBlockData }) });

    expect(warnings).toEqual([expect.objectContaining({
      code: 'SANITIZED', commandIndex: 0, blockId: 'n1', field: 'text',
    })]);
    expect(sanitizeBlockData).toHaveBeenCalledWith('paragraph', { text: [{ text: 'dirty' }], label: 'keep' });
    expect(draft.get('n1')?.data).toEqual({ text: [{ text: 'clean' }], label: 'keep' });
  });

  it('does not report sanitization for an unchanged literal string', () => {
    const { warnings, draft } = planOn(doc, [{
      name: 'block.insert', args: { type: 'paragraph', data: { text: '' } },
    }]);

    expect(warnings).toEqual([]);
    expect(draft.get('n1')?.data.text).toEqual([]);
  });

  it('warns on Markdown-looking text while keeping it literal', () => {
    const { draft, warnings } = planOn(doc, [{
      name: 'block.insert', args: { type: 'paragraph', data: { text: 'see **this**' } },
    }]);

    expect(warnings).toEqual([expect.objectContaining({
      code: 'LOOKS_LIKE_MARKDOWN', commandIndex: 0, blockId: 'n1', field: 'text',
    })]);
    expect(draft.get('n1')?.data.text).toEqual([{ text: 'see **this**' }]);
  });

  it('drops unknown marks, retains supported marks and embeds, and leaves the input alone', () => {
    const raw = [
      { text: 'a', marks: { bold: true, sparkle: 'bad', 'tag:span': { title: 'kept' } } },
      { text: 'b', marks: { bold: true, 'tag:span': { title: 'kept' } } },
      { embed: { page: { id: 'pg' } }, marks: { italic: true } },
    ];
    const before = structuredClone(raw);
    const { draft, warnings } = planOn(doc, [{
      name: 'block.insert', args: { type: 'paragraph', data: { text: raw } },
    }]);

    expect(draft.get('n1')?.data.text).toEqual([
      { text: 'ab', marks: { bold: true, 'tag:span': { title: 'kept' } } },
      { embed: { page: { id: 'pg' } }, marks: { italic: true } },
    ]);
    expect(warnings).toEqual([expect.objectContaining({
      code: 'UNKNOWN_MARK_DROPPED', commandIndex: 0, blockId: 'n1', field: 'text',
    })]);
    expect(raw).toEqual(before);
  });

  it('sanitizes before normalizing each created block', () => {
    const calls: string[] = [];
    const tools = new Map(TOOLS);
    tools.set('paragraph', tool('paragraph', {
      richTextFields: ['text'], defaultData: { text: 'default' },
    }, {
      normalize: data => {
        calls.push('normalize');
        return { ...data, normalized: true };
      },
    }));
    const { draft } = planOn(doc, [{
      name: 'block.insert', args: { type: 'toggle', children: [{ type: 'paragraph' }] },
    }], { tools, ports: stubPorts({
      sanitizeBlockData: (type, data) => {
        calls.push(`sanitize:${type}`);
        return { ...data, sanitized: true };
      },
    }) });

    expect(draft.get('n2')?.data).toEqual({
      text: [{ text: 'default' }], sanitized: true, normalized: true,
    });
    expect(calls).toEqual(['sanitize:toggle', 'sanitize:paragraph', 'normalize']);
  });

  it('uses caller data in place of default data and overlays prepared data', () => {
    const tools = new Map(TOOLS);
    tools.set('paragraph', tool('paragraph', {
      richTextFields: ['text'], defaultData: { text: 'default', omitted: true },
    }));
    const { draft } = planOn(doc, [{
      name: 'block.insert', args: { type: 'paragraph', data: { text: 'caller', keep: true } },
    }], { tools, prepared: new Map<number, unknown>([[0, { text: 'prepared', hostId: 'pg' }]]) });

    expect(draft.get('n1')?.data).toEqual({
      text: [{ text: 'prepared' }], keep: true, hostId: 'pg',
    });
  });

  it('refuses an existing caller ID without consuming a generated ID', () => {
    const newId = vi.fn(() => 'fresh');

    expect(failOf(() => planOn(doc, [{
      name: 'block.insert', args: { type: 'paragraph', id: 'p' },
    }], { ports: stubPorts({ newId }) }))).toMatchObject({
      code: 'INVALID_ARGS', commandIndex: 0, path: '/commands/0/args/id',
    });
    expect(newId).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'null child', child: null, suffix: '' },
    { label: 'missing child type', child: {}, suffix: '/type' },
    { label: 'empty child type', child: { type: '' }, suffix: '/type' },
    { label: 'array child data', child: { type: 'paragraph', data: [] }, suffix: '/data' },
    { label: 'numeric child ID', child: { type: 'paragraph', id: 2 }, suffix: '/id' },
    { label: 'child placement field', child: { type: 'paragraph', parentId: 'tg' }, suffix: '/parentId' },
  ])('validates a $label at its recursive InsertSpec pointer', ({ child, suffix }) => {
    expect(failOf(() => planOn(doc, [{
      name: 'block.insert', args: { type: 'toggle', children: [child] },
    }]))).toMatchObject({
      code: 'INVALID_ARGS', commandIndex: 0, path: `/commands/0/args/children/0${suffix}`,
    });
  });

  it('refuses repeated explicit child IDs before planning data', () => {
    const sanitizeBlockData = vi.fn((_type: string, data: Record<string, unknown>) => data);

    expect(failOf(() => planOn(doc, [{
      name: 'block.insert', args: { type: 'toggle', children: [
        { type: 'paragraph', id: 'same' }, { type: 'paragraph', id: 'same' },
      ] },
    }], { ports: stubPorts({ sanitizeBlockData }) }))).toMatchObject({
      code: 'INVALID_ARGS', commandIndex: 0, path: '/commands/0/args/children/1/id',
    });
    expect(sanitizeBlockData).not.toHaveBeenCalled();
  });

  it('refuses a nested child ID that repeats its ancestor', () => {
    expect(failOf(() => planOn(doc, [{
      name: 'block.insert', args: { type: 'toggle', id: 'same', children: [{ type: 'paragraph', id: 'same' }] },
    }]))).toMatchObject({ code: 'INVALID_ARGS', path: '/commands/0/args/children/0/id' });
  });

  it('reserves later explicit IDs before generating IDs for earlier inserts', () => {
    const { draft, plan } = planOn(doc, [
      { name: 'block.insert', args: { type: 'paragraph' } },
      { name: 'block.insert', args: { type: 'paragraph', id: 'n1' } },
    ]);

    expect(plan.results).toEqual([{ id: 'n2', childIds: [] }, { id: 'n1', childIds: [] }]);
    expect(draft.childrenOf(null)).toEqual(['p', 'tg', 'tbl', 'n2', 'n1']);
  });

  it('reserves explicit IDs nested in later commands before generating earlier child IDs', () => {
    const { plan } = planOn(doc, [
      { name: 'block.insert', args: { type: 'toggle', children: [{ type: 'paragraph' }] } },
      { name: 'block.insert', args: { type: 'toggle', id: 'later', children: [{ type: 'paragraph', id: 'n2' }] } },
    ]);

    expect(plan.results).toEqual([{ id: 'n1', childIds: ['n3'] }, { id: 'later', childIds: ['n2'] }]);
    expect(plan.changed.created).toEqual(['n1', 'n3', 'later', 'n2']);
  });

  it('refuses repeated explicit IDs across pending and later inserts before planning', () => {
    const sanitizeBlockData = vi.fn((_type: string, data: Record<string, unknown>) => data);

    expect(failOf(() => planOn(doc, [
      { name: 'block.insert', args: { type: 'toggle', id: 'same' } },
      { name: 'block.insert', args: { type: 'paragraph', id: 'same' } },
    ], {
      prepared: new Map<number, unknown>([[0, PREPARE_PENDING]]),
      ports: stubPorts({ sanitizeBlockData }),
    }))).toMatchObject({ code: 'INVALID_ARGS', commandIndex: 1, path: '/commands/1/args/id' });
    expect(sanitizeBlockData).not.toHaveBeenCalled();
  });

  it('resolves an earlier ref as a parent', () => {
    const { plan, draft } = planOn(doc, [
      { name: 'block.insert', args: { type: 'toggle' }, ref: 'a' },
      { name: 'block.insert', args: { type: 'paragraph', parentId: '$a' } },
    ]);

    expect(plan.refs).toEqual({ a: 'n1' });
    expect(draft.childrenOf('n1')).toEqual(['n2']);
  });

  it('resolves an earlier ref as a sibling anchor', () => {
    const { draft } = planOn(doc, [
      { name: 'block.insert', args: { type: 'paragraph', position: 'start' }, ref: 'a' },
      { name: 'block.insert', args: { type: 'paragraph', position: { after: '$a' } } },
    ]);

    expect(draft.childrenOf(null)).toEqual(['n1', 'n2', 'p', 'tg', 'tbl']);
  });

  it('refuses forward refs even though future explicit IDs are reserved', () => {
    expect(failOf(() => planOn(doc, [
      { name: 'block.insert', args: { type: 'paragraph', parentId: '$a' } },
      { name: 'block.insert', args: { type: 'toggle', id: 'later' }, ref: 'a' },
    ]))).toMatchObject({
      code: 'BLOCK_NOT_FOUND', commandIndex: 0, path: '/commands/0/args/parentId', details: { ref: 'a' },
    });
  });

  it('does not expose a future reserved explicit ID as an existing parent', () => {
    expect(failOf(() => planOn(doc, [
      { name: 'block.insert', args: { type: 'paragraph', parentId: 'later' } },
      { name: 'block.insert', args: { type: 'toggle', id: 'later' } },
    ]))).toMatchObject({ code: 'BLOCK_NOT_FOUND', commandIndex: 0, details: { id: 'later' } });
  });

  it('refuses duplicate refs at the ref pointer', () => {
    expect(failOf(() => planOn(doc, [
      { name: 'block.insert', args: { type: 'toggle' }, ref: 'a' },
      { name: 'block.insert', args: { type: 'toggle' }, ref: 'a' },
    ]))).toMatchObject({ code: 'INVALID_ARGS', commandIndex: 1, path: '/commands/1/ref' });
  });

  it('gives pending inserts a real placeholder block so later parent and sibling refs resolve', () => {
    const { plan, draft } = planOn(doc, [
      { name: 'block.insert', args: { type: 'toggle' }, ref: 'pending' },
      { name: 'block.insert', args: { type: 'paragraph', parentId: '$pending' } },
      { name: 'block.insert', args: { type: 'paragraph', position: { after: '$pending' } } },
    ], { prepared: new Map<number, unknown>([[0, PREPARE_PENDING]]) });

    expect(draft.childrenOf('n1')).toEqual(['n2']);
    expect(plan.refs).toEqual({ pending: 'n1' });
    expect(draft.get('n1')?.type).toBe('toggle');
    expect(draft.childrenOf(null)).toEqual(['p', 'tg', 'tbl', 'n1', 'n3']);
    expect(plan.results[0]).toEqual({ id: 'n1', childIds: [] });
  });

  it('still refuses an unknown tool during pending pre-plan', () => {
    expect(failOf(() => planOn(doc, [{
      name: 'block.insert', args: { type: 'kanban' },
    }], { prepared: new Map<number, unknown>([[0, PREPARE_PENDING]]) }))).toMatchObject({
      code: 'UNKNOWN_TOOL', commandIndex: 0, path: '/commands/0/args/type',
    });
  });

  it('keeps pending explicit child skeletons usable by later commands', () => {
    const { draft, plan } = planOn(doc, [
      { name: 'block.insert', args: {
        type: 'toggle', id: 'pending', children: [{ type: 'toggle', id: 'child' }],
      }, ref: 'parent' },
      { name: 'block.insert', args: { type: 'paragraph', parentId: 'child' } },
    ], { prepared: new Map<number, unknown>([[0, PREPARE_PENDING]]) });

    expect(draft.childrenOf('child')).toEqual(['n1']);
    expect(draft.childrenOf('pending')).toEqual(['child']);
    expect(plan.refs).toEqual({ parent: 'pending' });
    expect(plan.results[0]).toEqual({ id: 'pending', childIds: ['child'] });
  });

  it('still checks child rules through a pending parent before preparation', () => {
    expect(failOf(() => planOn(doc, [
      { name: 'block.insert', args: { type: 'column_list', children: [] }, ref: 'pending' },
      { name: 'block.insert', args: { type: 'paragraph', parentId: '$pending' } },
    ], { prepared: new Map<number, unknown>([[0, PREPARE_PENDING]]) }))).toMatchObject({
      code: 'PLACEMENT_REFUSED', commandIndex: 1, details: { reason: 'CHILD_NOT_ALLOWED', allowed: ['column'] },
    });
  });

  it('keeps caller warnings when a later command fails during pre-plan', () => {
    const warnings: AgentWarning[] = [];
    const snapshot = DocSnapshot.fromOutput(doc);

    expect(failOf(() => planBatch({
      snapshot, batch: { commands: [
        { name: 'block.insert', args: { type: 'paragraph', data: { text: '**literal**' } } },
        { name: 'block.insert', args: { type: 'toggle' }, ref: 'pending' },
        { name: 'block.insert', args: { type: 'kanban' } },
      ] },
      ctx: plannerContext({ prepared: new Map<number, unknown>([[1, PREPARE_PENDING]]) }),
      stamp: { actorId: 'agent', at: 1 }, warnings,
    }))).toMatchObject({ code: 'UNKNOWN_TOOL', commandIndex: 2 });
    expect(warnings).toEqual([expect.objectContaining({ code: 'LOOKS_LIKE_MARKDOWN', commandIndex: 0 })]);
    expect(snapshot.has('n1')).toBe(false);
  });

  it('routes owned tools without defaults to their create action, including renamed tools', () => {
    const commands = coreCommandMap();
    const tools = new Map(TOOLS);
    const table = TOOLS.get('table');

    if (table === undefined) {
      throw new Error('The table fixture is required');
    }
    tools.set('grid', tool('grid', { ...table.entry, name: 'grid', selfPlacesChildren: false }));
    commands.set('table.create', createOf('table'));
    commands.set('grid.create', createOf('grid'));
    commands.set('column_list.create', createOf('column_list'));

    expect(failOf(() => planOn(doc, [{
      name: 'block.insert', args: { type: 'table' },
    }], { commands, tools }))).toMatchObject({
      code: 'INVALID_ARGS', commandIndex: 0, path: '/commands/0/args/type', details: { use: 'table.create' },
    });
    expect(failOf(() => planOn(doc, [{
      name: 'block.insert', args: { type: 'grid' },
    }], { commands, tools }))).toMatchObject({ code: 'INVALID_ARGS', details: { use: 'grid.create' } });
    expect(planOn(doc, [{
      name: 'block.insert', args: { type: 'column_list' },
    }], { commands, tools }).draft.get('n1')?.type).toBe('column_list');
    expect(planOn(doc, [{ name: 'block.insert', args: { type: 'table' } }]).draft.get('n1')?.type).toBe('table');
  });

  it('does not route non-owned tools to create merely because that action exists', () => {
    const commands = coreCommandMap();
    const tools = new Map(TOOLS);
    tools.set('bookmark', tool('bookmark'));
    commands.set('bookmark.create', createOf('bookmark'));

    expect(planOn(doc, [{
      name: 'block.insert', args: { type: 'bookmark' },
    }], { commands, tools }).draft.get('n1')?.type).toBe('bookmark');
  });
});

describe('block.insert controlling corrections', () => {
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
  ])('stores and resolves a $ref ref as an own serializable entry', ({ ref }) => {
    const { plan, draft } = planOn(doc, [
      { name: 'block.insert', args: { type: 'toggle' }, ref },
      { name: 'block.insert', args: { type: 'paragraph', parentId: `$${ref}` } },
    ]);

    expect(draft.childrenOf('n1')).toEqual(['n2']);
    expect(Object.prototype.hasOwnProperty.call(plan.refs, ref)).toBe(true);
    expect(plan.refs[ref]).toBe('n1');
    expect(JSON.stringify(plan.refs)).toBe(JSON.stringify({ [ref]: 'n1' }));
  });

  it.each([
    { ref: 'constructor' },
    { ref: 'toString' },
    { ref: '__proto__' },
  ])('refuses an uncreated $ref ref instead of reading a prototype property', ({ ref }) => {
    expect(failOf(() => planOn(doc, [{
      name: 'block.insert', args: { type: 'paragraph', parentId: `$${ref}` },
    }]))).toMatchObject({
      code: 'BLOCK_NOT_FOUND', commandIndex: 0,
      path: '/commands/0/args/parentId', details: { ref },
    });
  });

  it.each([
    { label: 'null segment', value: null, suffix: '' },
    { label: 'primitive segment', value: 'raw', suffix: '' },
    { label: 'empty segment', value: {}, suffix: '' },
    { label: 'non-string text', value: { text: 3 }, suffix: '/text' },
    { label: 'ambiguous text and embed', value: { text: 'x', embed: { html: 'x' } }, suffix: '' },
    { label: 'extra segment field', value: { text: 'x', checked: true }, suffix: '' },
    { label: 'missing embed shape', value: { embed: {} }, suffix: '/embed' },
    { label: 'non-string page ID', value: { embed: { page: { id: 3 } } }, suffix: '/embed' },
    { label: 'non-string equation expression', value: { embed: { equation: { expression: 3 } } }, suffix: '/embed' },
    { label: 'non-string HTML embed', value: { embed: { html: 3 } }, suffix: '/embed' },
    { label: 'multiple embed shapes', value: { embed: { html: 'x', page: { id: 'pg' } } }, suffix: '/embed' },
    { label: 'extra page embed field', value: { embed: { page: { id: 'pg', extra: true } } }, suffix: '/embed' },
    { label: 'null marks', value: { text: 'x', marks: null }, suffix: '/marks' },
    { label: 'array marks', value: { text: 'x', marks: [] }, suffix: '/marks' },
    { label: 'string marks', value: { text: 'x', marks: 'bold' }, suffix: '/marks' },
  ])('rejects a $label without silently dropping the supplied segment', ({ value, suffix }) => {
    const error = failOf(() => planOn(doc, [{
      name: 'block.insert', args: { type: 'paragraph', data: { text: [{ text: 'kept' }, value] } },
    }]));
    const pointer = `/commands/0/args/data/text/1${suffix}`;

    expect(error).toMatchObject({ code: 'INVALID_ARGS', commandIndex: 0 });
    expect(error.path === pointer || error.path?.startsWith(`${pointer}/`)).toBe(true);
  });

  it('reports a malformed embed inside a recursive child at its real input location', () => {
    const error = failOf(() => planOn(doc, [{
      name: 'block.insert', args: { type: 'toggle', children: [{
        type: 'paragraph', data: { text: [{ text: 'kept' }, { embed: { equation: {} } }] },
      }] },
    }]));
    const pointer = '/commands/0/args/children/0/data/text/1/embed';

    expect(error).toMatchObject({ code: 'INVALID_ARGS', commandIndex: 0 });
    expect(error.path === pointer || error.path?.startsWith(`${pointer}/`)).toBe(true);
  });

  it('keeps the existing normalization of recognized mark values', () => {
    const raw = [{ text: 'x', marks: {
      bold: false, italic: null, sup: true, color: 3, background: 'red',
      link: { href: 3 }, 'tag:span': { title: 'kept', ignored: 3 },
    } }];
    const before = structuredClone(raw);
    const { draft, warnings } = planOn(doc, [{
      name: 'block.insert', args: { type: 'paragraph', data: { text: raw } },
    }]);

    expect(draft.get('n1')?.data.text).toEqual([{
      text: 'x', marks: { sup: true, background: 'red', 'tag:span': { title: 'kept' } },
    }]);
    expect(warnings.filter(item => item.code === 'UNKNOWN_MARK_DROPPED')).toEqual([]);
    expect(raw).toEqual(before);
  });

  it.each([
    { label: 'explicit', defaults: false },
    { label: 'runtime-default', defaults: true },
  ])('refuses $label children of a fresh self-placing tool by its declared facts', ({ defaults }) => {
    const tools = new Map(TOOLS);
    const commands = coreCommandMap();
    tools.set('hostedLayout', tool('hostedLayout', { selfPlacesChildren: true },
      defaults ? { defaultChildren: [{ type: 'paragraph' }] } : {}));
    commands.set('hostedLayout.place', {
      name: 'hostedLayout.place', args: { type: 'object' }, readOnly: false,
      available: true, source: { tool: 'hostedLayout', target: 'block' },
    });
    const args = defaults
      ? { type: 'hostedLayout' }
      : { type: 'hostedLayout', children: [{ type: 'paragraph' }] };

    expect(failOf(() => planOn(doc, [{
      name: 'block.insert', args,
    }], { tools, commands }))).toMatchObject({
      code: 'PLACEMENT_REFUSED', commandIndex: 0,
      details: { reason: 'SELF_PLACED_PARENT', use: ['hostedLayout.place'] },
    });
  });

  it('refuses self-placed children even when their fresh parent is nested in a new tree', () => {
    const tools = new Map(TOOLS);
    const commands = coreCommandMap();
    tools.set('hostedLayout', tool('hostedLayout', { selfPlacesChildren: true }));
    commands.set('hostedLayout.place', {
      name: 'hostedLayout.place', args: { type: 'object' }, readOnly: false,
      available: true, source: { tool: 'hostedLayout', target: 'block' },
    });

    expect(failOf(() => planOn(doc, [{
      name: 'block.insert', args: { type: 'toggle', children: [{
        type: 'hostedLayout', children: [{ type: 'paragraph' }],
      }] },
    }], { tools, commands }))).toMatchObject({
      code: 'PLACEMENT_REFUSED', commandIndex: 0,
      details: { reason: 'SELF_PLACED_PARENT', use: ['hostedLayout.place'] },
    });
  });

  it('allows a fresh self-placing tool with explicit empty children instead of defaults', () => {
    const tools = new Map(TOOLS);
    tools.set('hostedLayout', tool('hostedLayout', { selfPlacesChildren: true }, {
      defaultChildren: [{ type: 'paragraph' }],
    }));
    const { draft } = planOn(doc, [{
      name: 'block.insert', args: { type: 'hostedLayout', children: [] },
    }], { tools });

    expect(draft.childrenOf('n1')).toEqual([]);
    expect(draft.get('n1')?.type).toBe('hostedLayout');
  });

  it('refuses a denied first demotion fallback rather than searching later allowed tools', () => {
    const tools = new Map(TOOLS);
    tools.set('limited', tool('limited', {
      children: { accepts: true, allow: ['paragraph', 'column'], deny: ['paragraph'],
        ownedByTool: false, layout: false, deletedWithParent: false },
    }));
    const snapshot = DocSnapshot.fromOutput({ blocks: [{ id: 'limit', type: 'limited', data: {} }] });
    const warnings: AgentWarning[] = [];

    expect(failOf(() => planBatch({
      snapshot, batch: { commands: [{
        name: 'block.insert', args: { type: 'table', parentId: 'limit', demote: true },
      }] },
      ctx: plannerContext({ tools }), stamp: { actorId: 'agent', at: 1 }, warnings,
    }))).toMatchObject({
      code: 'PLACEMENT_REFUSED', commandIndex: 0,
      details: { reason: 'CHILD_NOT_ALLOWED', allowed: ['paragraph', 'column'] },
    });
    expect(warnings.filter(item => item.code === 'DEMOTED')).toEqual([]);
    expect(snapshot.childrenOf('limit')).toEqual([]);
  });

  it('refuses a demotion fallback restricted in the same table-cell placement', () => {
    const tools = new Map(TOOLS);
    tools.set('limited', tool('limited', {
      children: { accepts: true, allow: ['header'], ownedByTool: false,
        layout: false, deletedWithParent: false },
    }));
    const snapshot = DocSnapshot.fromOutput({ blocks: [
      { id: 'table', type: 'table', data: { content: [[{ blocks: ['limit'] }]] }, content: ['limit'] },
      { id: 'limit', type: 'limited', data: {}, parent: 'table' },
    ] });
    const warnings: AgentWarning[] = [];

    expect(failOf(() => planBatch({
      snapshot, batch: { commands: [{
        name: 'block.insert', args: { type: 'paragraph', parentId: 'limit', demote: true },
      }] },
      ctx: plannerContext({ tools }), stamp: { actorId: 'agent', at: 1 }, warnings,
    }))).toMatchObject({
      code: 'PLACEMENT_REFUSED', commandIndex: 0, details: { reason: 'RESTRICTED_IN_CELL' },
    });
    expect(warnings.filter(item => item.code === 'DEMOTED')).toEqual([]);
    expect(snapshot.childrenOf('limit')).toEqual([]);
  });

  it('prepares known pending data without normalizing until the real pass', () => {
    const tools = new Map(TOOLS);
    const normalize = vi.fn((data: Record<string, unknown>) => ({ ...data, normalized: true }));
    const sanitizeBlockData = vi.fn((_type: string, data: Record<string, unknown>) => ({ ...data, label: 'clean' }));
    const markdownToBlocks = vi.fn(() => Promise.resolve({ blocks: [], warnings: [] }));
    tools.set('hosted', tool('hosted', {
      richTextFields: ['text'], insertRequires: ['host'],
      data: { type: 'object', properties: { hostId: { type: 'string' } }, required: ['hostId'] },
    }, { normalize }));
    const ports = stubPorts({ sanitizeBlockData, markdownToBlocks });
    const commands: AgentCommand[] = [{
      name: 'block.insert', args: { type: 'hosted', data: { text: 'literal', label: 'dirty' } }, ref: 'pending',
    }];
    const before = structuredClone(commands);
    const pending = planOn(doc, commands, {
      tools, ports, prepared: new Map<number, unknown>([[0, PREPARE_PENDING]]),
    });

    expect(normalize).not.toHaveBeenCalled();
    expect(pending.draft.get('n1')?.data).toEqual({ text: [{ text: 'literal' }], label: 'clean' });
    expect(pending.plan.refs).toEqual({ pending: 'n1' });
    expect(sanitizeBlockData).toHaveBeenCalledWith('hosted', { text: [{ text: 'literal' }], label: 'dirty' });
    expect(pending.warnings).toEqual([expect.objectContaining({
      code: 'SANITIZED', commandIndex: 0, blockId: 'n1', field: 'label',
    })]);
    expect(markdownToBlocks).not.toHaveBeenCalled();

    const real = planOn(doc, commands, {
      tools, ports, prepared: new Map<number, unknown>([[0, { hostId: 'pg' }]]),
    });

    expect(real.draft.get('n2')?.data).toEqual({
      text: [{ text: 'literal' }], label: 'clean', hostId: 'pg', normalized: true,
    });
    expect(normalize).toHaveBeenCalledTimes(1);
    expect(normalize).toHaveBeenCalledWith({ text: [{ text: 'literal' }], label: 'clean', hostId: 'pg' });
    expect(markdownToBlocks).not.toHaveBeenCalled();
    expect(commands).toEqual(before);
  });

  it.each([
    { label: 'scalar rich field', text: 3, suffix: '' },
    { label: 'malformed rich embed', text: [{ embed: { page: {} } }], suffix: '/0/embed' },
  ])('does not skip a known $label error while an insert is pending', ({ text, suffix }) => {
    const tools = new Map(TOOLS);
    const normalize = vi.fn((data: Record<string, unknown>) => data);
    tools.set('hosted', tool('hosted', {
      richTextFields: ['text'], insertRequires: ['host'],
    }, { normalize }));
    const error = failOf(() => planOn(doc, [{
      name: 'block.insert', args: { type: 'hosted', data: { text } },
    }], { tools, prepared: new Map<number, unknown>([[0, PREPARE_PENDING]]) }));
    const pointer = `/commands/0/args/data/text${suffix}`;

    expect(error).toMatchObject({ code: 'INVALID_ARGS', commandIndex: 0 });
    expect(error.path === pointer || error.path?.startsWith(`${pointer}/`)).toBe(true);
    expect(normalize).not.toHaveBeenCalled();
  });

  it('retains warnings from supplied pending data when a later pre-plan command fails', () => {
    const tools = new Map(TOOLS);
    const normalize = vi.fn((data: Record<string, unknown>) => data);
    tools.set('hosted', tool('hosted', {
      richTextFields: ['text'], insertRequires: ['host'],
    }, { normalize }));
    const warnings: AgentWarning[] = [];
    const ports = stubPorts({
      sanitizeBlockData: (_type, data) => ({ ...data, label: 'clean' }),
    });

    expect(failOf(() => planBatch({
      snapshot: DocSnapshot.fromOutput(doc),
      batch: { commands: [
        { name: 'block.insert', args: { type: 'hosted', data: { text: 'literal', label: 'dirty' } } },
        { name: 'block.insert', args: { type: 'missing' } },
      ] },
      ctx: plannerContext({ tools, ports, prepared: new Map<number, unknown>([[0, PREPARE_PENDING]]) }),
      stamp: { actorId: 'agent', at: 1 }, warnings,
    }))).toMatchObject({ code: 'UNKNOWN_TOOL', commandIndex: 1 });
    expect(warnings).toEqual([expect.objectContaining({
      code: 'SANITIZED', commandIndex: 0, blockId: 'n1', field: 'label',
    })]);
    expect(normalize).not.toHaveBeenCalled();
  });
});

describe('T8-R1 explicit descendant ID reservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reserves explicit runtime-default child IDs before allocating an anonymous insert parent', () => {
    const tools = new Map(TOOLS);
    const toggle = tools.get('toggle');

    if (toggle === undefined) {
      throw new Error('The toggle fixture is required');
    }
    tools.set('toggle', {
      ...toggle,
      runtime: { ...toggle.runtime, defaultChildren: [{ type: 'paragraph', id: 'n1' }] },
    });
    const { plan, draft } = planOn(doc, [{ name: 'block.insert', args: { type: 'toggle' } }], { tools });

    expect(plan.results).toEqual([{ id: 'n2', childIds: ['n1'] }]);
    expect(draft.childrenOf('n2')).toEqual(['n1']);
  });
});

describe('T8-R1 batch-wide effective ID reservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reserves explicit runtime-default child IDs in later commands before allocating earlier anonymous inserts', () => {
    const tools = new Map(TOOLS);
    const toggle = tools.get('toggle');

    if (toggle === undefined) {
      throw new Error('The toggle fixture is required');
    }
    tools.set('toggle', {
      ...toggle,
      runtime: { ...toggle.runtime, defaultChildren: [{ type: 'paragraph', id: 'n1' }] },
    });
    const { plan } = planOn(doc, [
      { name: 'block.insert', args: { type: 'paragraph' } },
      { name: 'block.insert', args: { type: 'toggle' } },
    ], { tools });

    expect(plan.results).toEqual([{ id: 'n2', childIds: [] }, { id: 'n3', childIds: ['n1'] }]);
  });
});
