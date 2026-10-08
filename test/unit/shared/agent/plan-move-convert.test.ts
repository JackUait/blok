// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentFailure } from '../../../../src/shared/agent/errors';
import { isRichText } from '../../../../src/shared/rich-text/guards';
import { coreCommandMap, planOn, stubPorts, TOOLS, tool } from './fixtures';

import type { AgentCommand, OutputData } from '../../../../types';
import type { PlannerTool } from '../../../../src/shared/agent/types';

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

const registered = (name: string): PlannerTool => {
  const found = TOOLS.get(name);

  if (found === undefined) {
    throw new Error('Missing fixture tool');
  }

  return found;
};

const doc: OutputData = { blocks: [
  { id: 'a', type: 'paragraph', data: { text: [{ text: 'A', marks: { bold: true } }] } },
  { id: 'tg', type: 'toggle', data: { text: [{ text: 'Toggle', marks: { italic: true } }], old: 'legacy' }, tunes: { color: 'gray' }, content: ['k', 'l', 'm'] },
  { id: 'k', type: 'paragraph', data: { text: [{ text: 'K' }] }, parent: 'tg' },
  { id: 'l', type: 'paragraph', data: { text: [{ text: 'L' }] }, parent: 'tg' },
  { id: 'm', type: 'paragraph', data: { text: [{ text: 'M' }] }, parent: 'tg' },
  { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
  { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['x', 'z'] },
  { id: 'x', type: 'paragraph', data: { text: [] }, parent: 'c1' },
  { id: 'z', type: 'paragraph', data: { text: [] }, parent: 'c1' },
  { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['y'] },
  { id: 'y', type: 'paragraph', data: { text: [] }, parent: 'c2' },
  { id: 'dv', type: 'divider', data: {} },
  { id: 'kb', type: 'kanban', data: { host: 'opaque' }, content: ['unknownChild'] },
  { id: 'unknownChild', type: 'host-child', data: {}, parent: 'kb' },
] };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('block.move planning', () => {
  it('moves the whole subtree without rewriting its data or tunes', () => {
    const { plan, draft } = planOn(doc, [{
      name: 'block.move', args: { id: 'tg', parentId: 'a', position: 'end' },
    }]);

    expect(draft.childrenOf('a')).toEqual(['tg']);
    expect(draft.childrenOf('tg')).toEqual(['k', 'l', 'm']);
    expect(draft.parentOf('k')).toBe('tg');
    expect(draft.get('tg')?.data).toEqual({ text: [{ text: 'Toggle', marks: { italic: true } }], old: 'legacy' });
    expect(draft.get('tg')?.tunes).toEqual({ color: 'gray' });
    expect(draft.childrenOf(null)).toEqual(['a', 'cl', 'dv', 'kb']);
    expect(plan.edits).toEqual([{ op: 'move', id: 'tg', parentId: 'a', afterId: null }]);
    expect(plan.results).toEqual([{ id: 'tg' }]);
    expect(plan.changed).toEqual({ created: [], updated: [], moved: ['tg'], removed: [] });
    expect(doc.blocks.find(block => block.id === 'tg')?.parent).toBeUndefined();
  });

  it('moves an opaque block with its subtree', () => {
    const { plan, draft } = planOn(doc, [{
      name: 'block.move', args: { id: 'kb', position: 'start' },
    }]);

    expect(draft.childrenOf(null)).toEqual(['kb', 'a', 'tg', 'cl', 'dv']);
    expect(draft.childrenOf('kb')).toEqual(['unknownChild']);
    expect(draft.get('kb')?.data).toEqual({ host: 'opaque' });
    expect(plan.changed.moved).toEqual(['kb']);
  });

  const columnMoves: Array<{
    name: string; args: AgentCommand['args'];
    destination: string | null; destinationOrder: string[];
    source: string | null; sourceOrder: string[];
    unaffected: string | null; unaffectedOrder: string[];
  }> = [
    { name: 'into a column', args: { id: 'a', parentId: 'c1', position: 'start' },
      destination: 'c1', destinationOrder: ['a', 'x', 'z'],
      source: null, sourceOrder: ['tg', 'cl', 'dv', 'kb'], unaffected: 'c2', unaffectedOrder: ['y'] },
    { name: 'out of a column', args: { id: 'x', parentId: null, position: 'start' },
      destination: null, destinationOrder: ['x', 'a', 'tg', 'cl', 'dv', 'kb'],
      source: 'c1', sourceOrder: ['z'], unaffected: 'c2', unaffectedOrder: ['y'] },
    { name: 'between columns', args: { id: 'x', parentId: 'c2', position: 'end' },
      destination: 'c2', destinationOrder: ['y', 'x'],
      source: 'c1', sourceOrder: ['z'], unaffected: null, unaffectedOrder: ['a', 'tg', 'cl', 'dv', 'kb'] },
  ];

  it.each(columnMoves)('allows an existing block $name', ({ args, destination, destinationOrder, source, sourceOrder, unaffected, unaffectedOrder }) => {
    const { draft } = planOn(doc, [{ name: 'block.move', args }]);

    expect(draft.childrenOf(destination)).toEqual(destinationOrder);
    expect(draft.childrenOf(source)).toEqual(sourceOrder);
    expect(draft.childrenOf(unaffected)).toEqual(unaffectedOrder);
  });

  const reorders: Array<{ name: string; args: AgentCommand['args']; expected: string[] }> = [
    { name: 'first child to end', args: { id: 'k', parentId: 'tg', position: 'end' }, expected: ['l', 'm', 'k'] },
    { name: 'last child to end', args: { id: 'm', parentId: 'tg', position: 'end' }, expected: ['k', 'l', 'm'] },
    { name: 'child before its next sibling', args: { id: 'l', position: { before: 'm' } }, expected: ['k', 'l', 'm'] },
    { name: 'last child before first', args: { id: 'm', position: { before: 'k' } }, expected: ['m', 'k', 'l'] },
    { name: 'first child after last', args: { id: 'k', position: { after: 'm' } }, expected: ['l', 'm', 'k'] },
  ];

  it.each(reorders)('keeps sibling order correct for $name', ({ args, expected }) => {
    const { draft } = planOn(doc, [{ name: 'block.move', args }]);

    expect(draft.childrenOf('tg')).toEqual(expected);
  });

  it('infers the parent from an earlier creation ref in the sibling position', () => {
    const { draft, plan } = planOn(doc, [
      { name: 'block.insert', ref: '__proto__', args: { type: 'paragraph', id: 'anchor', parentId: 'tg', data: { text: 'Anchor' } } },
      { name: 'block.move', args: { id: 'a', position: { before: '$__proto__' } } },
    ]);

    expect(draft.childrenOf('tg')).toEqual(['k', 'l', 'm', 'a', 'anchor']);
    expect(draft.parentOf('a')).toBe('tg');
    expect(plan.refs['__proto__']).toBe('anchor');
    expect(Object.hasOwn(plan.refs, '__proto__')).toBe(true);
    expect(plan.changed).toEqual({ created: ['anchor'], updated: [], moved: ['a'], removed: [] });
  });

  it.each(['tg', 'k'])('refuses moving a container under its own subtree at %s', parentId => {
    expect(failOf(() => planOn(doc, [{
      name: 'block.move', args: { id: 'tg', parentId, position: 'end' },
    }]))).toMatchObject({ code: 'PLACEMENT_REFUSED', details: { reason: 'OWN_SUBTREE' } });
  });

  it('refuses a new parent that takes no children', () => {
    expect(failOf(() => planOn(doc, [{
      name: 'block.move', args: { id: 'a', parentId: 'dv', position: 'end' },
    }]))).toMatchObject({ code: 'PLACEMENT_REFUSED', details: { reason: 'TAKES_NO_CHILDREN' } });
  });

  it.each(['before', 'after'])('refuses a position %s itself', direction => {
    const position = direction === 'before' ? { before: 'a' } : { after: 'a' };

    expect(failOf(() => planOn(doc, [{
      name: 'block.move', args: { id: 'a', position },
    }]))).toMatchObject({ code: 'INVALID_ARGS', commandIndex: 0, path: '/commands/0/args/position' });
  });

  it('refuses a sibling outside the explicitly requested parent', () => {
    expect(failOf(() => planOn(doc, [{
      name: 'block.move', args: { id: 'a', parentId: 'c1', position: { after: 'k' } },
    }]))).toMatchObject({ code: 'PLACEMENT_REFUSED', details: { reason: 'NOT_A_CHILD' } });
  });

  it.each([
    { name: 'entering an owning container', args: { id: 'a', parentId: 'cl', position: 'end' } },
    { name: 'leaving an owning container', args: { id: 'c1', parentId: null, position: 'end' } },
  ])('keeps ownership checks when $name', ({ args }) => {
    expect(failOf(() => planOn(doc, [{ name: 'block.move', args }]))).toMatchObject({
      code: 'PLACEMENT_REFUSED', details: { reason: 'OWNS_CHILDREN' },
    });
  });

  it('refuses disallowed children instead of demoting a move', () => {
    const tools = new Map(TOOLS);

    tools.set('frame', tool('frame', {
      children: { accepts: true, allow: ['header'], ownedByTool: false, layout: false, deletedWithParent: false },
    }));
    const input: OutputData = { blocks: [
      { id: 'a', type: 'paragraph', data: { text: [] } },
      { id: 'frame', type: 'frame', data: {} },
    ] };

    expect(failOf(() => planOn(input, [{
      name: 'block.move', args: { id: 'a', parentId: 'frame', position: 'end' },
    }], { tools }))).toMatchObject({
      code: 'PLACEMENT_REFUSED', details: { reason: 'CHILD_NOT_ALLOWED', allowed: ['header'] },
    });
  });

  it('refuses a self-placing destination and names its tool action', () => {
    const commands = coreCommandMap();

    commands.set('table.insertIntoCell', {
      name: 'table.insertIntoCell', args: { type: 'object' }, readOnly: false, available: true,
      source: { tool: 'table', target: 'block' },
    });
    const input: OutputData = { blocks: [
      { id: 'a', type: 'paragraph', data: { text: [] } },
      { id: 'table', type: 'table', data: { content: [] } },
    ] };

    expect(failOf(() => planOn(input, [{
      name: 'block.move', args: { id: 'a', parentId: 'table', position: 'end' },
    }], { commands }))).toMatchObject({
      code: 'PLACEMENT_REFUSED', details: { reason: 'SELF_PLACED_PARENT', use: ['table.insertIntoCell'] },
    });
  });

  it('refuses a same-parent reorder under a self-placing parent with action hints', () => {
    const commands = coreCommandMap();

    commands.set('table.insertIntoCell', {
      name: 'table.insertIntoCell', args: { type: 'object' }, readOnly: false, available: true,
      source: { tool: 'table', target: 'block' },
    });
    const input: OutputData = { blocks: [
      { id: 'table', type: 'table', data: { content: [[{ blocks: ['a', 'peer'] }]] }, content: ['a', 'peer'] },
      { id: 'a', type: 'paragraph', data: { text: [] }, parent: 'table' },
      { id: 'peer', type: 'paragraph', data: { text: [] }, parent: 'table' },
    ] };

    expect(failOf(() => planOn(input, [{
      name: 'block.move', args: { id: 'a', position: { after: 'peer' } },
    }], { commands }))).toMatchObject({
      code: 'PLACEMENT_REFUSED', details: { reason: 'SELF_PLACED_PARENT', use: ['table.insertIntoCell'] },
    });
  });

  const cellDoc: OutputData = { blocks: [
    { id: 'outside', type: 'paragraph', data: { text: [] } },
    { id: 'table', type: 'table', data: { content: [[{ blocks: ['left', 'peer'] }, { blocks: ['right'] }]] }, content: ['left', 'peer', 'right'] },
    { id: 'left', type: 'toggle', data: { text: [] }, parent: 'table', content: ['inside'] },
    { id: 'inside', type: 'paragraph', data: { text: [] }, parent: 'left' },
    { id: 'peer', type: 'toggle', data: { text: [] }, parent: 'table' },
    { id: 'right', type: 'toggle', data: { text: [] }, parent: 'table' },
  ] };

  it.each([
    { name: 'into a cell', args: { id: 'outside', parentId: 'left', position: 'end' } },
    { name: 'out of a cell', args: { id: 'inside', parentId: null, position: 'end' } },
    { name: 'between cells', args: { id: 'inside', parentId: 'right', position: 'end' } },
  ])('refuses a move $name', ({ args }) => {
    expect(failOf(() => planOn(cellDoc, [{ name: 'block.move', args }]))).toMatchObject({
      code: 'PLACEMENT_REFUSED', details: { reason: 'TABLE_CELL_BOUNDARY' },
    });
  });

  it('allows reparenting a nested block within its existing cell', () => {
    const { draft } = planOn(cellDoc, [{
      name: 'block.move', args: { id: 'inside', parentId: 'peer', position: 'end' },
    }]);

    expect(draft.childrenOf('peer')).toEqual(['inside']);
    expect(draft.childrenOf('left')).toEqual([]);
    expect(draft.cellOf('inside')).toEqual({ tableId: 'table', row: 0, col: 0 });
  });

  it.each([
    { args: { id: 'missing', position: 'end' }, path: '/commands/0/args/id' },
    { args: { id: 'a', parentId: 'missing', position: 'end' }, path: '/commands/0/args/parentId' },
    { args: { id: 'a', position: { after: '$missing' } }, path: '/commands/0/args/position/after' },
  ])('reports an unresolved move ID at $path', ({ args, path }) => {
    expect(failOf(() => planOn(doc, [{ name: 'block.move', args }]))).toMatchObject({
      code: 'BLOCK_NOT_FOUND', commandIndex: 0, path,
    });
  });
});

describe('block.convert planning', () => {
  it('carries rich text while preserving identity, position, children and tunes', () => {
    const tools = new Map(TOOLS);

    tools.set('retaining-container', tool('retaining-container', {
      richTextFields: ['text'], conversion: { import: 'text', export: 'text' },
      children: { accepts: true, allow: ['paragraph'], ownedByTool: false, layout: false, deletedWithParent: false },
      defaultData: { text: [], mode: 'default' },
    }));
    const { draft, plan } = planOn(doc, [{
      name: 'block.convert', args: { id: 'tg', type: 'retaining-container', data: { mode: 'converted' } },
    }], { tools });

    expect(draft.get('tg')?.data).toEqual({ text: [{ text: 'Toggle', marks: { italic: true } }], mode: 'converted' });
    expect(draft.childrenOf('tg')).toEqual(['k', 'l', 'm']);
    expect(draft.get('tg')?.type).toBe('retaining-container');
    expect(draft.get('tg')?.tunes).toEqual({ color: 'gray' });
    expect(draft.parentOf('tg')).toBeNull();
    expect(draft.childrenOf(null)).toEqual(['a', 'tg', 'cl', 'dv', 'kb']);
    expect(plan.edits).toEqual([{
      op: 'replaceType', id: 'tg', type: 'retaining-container',
      data: { text: [{ text: 'Toggle', marks: { italic: true } }], mode: 'converted' },
    }]);
    expect(plan.results).toEqual([{ id: 'tg' }]);
    expect(plan.changed).toEqual({ created: [], updated: ['tg'], moved: [], removed: [] });
  });

  it('imports a plain source field as literal rich text, not HTML', () => {
    const tools = new Map(TOOLS);

    tools.set('code', tool('code', { conversion: { import: 'code', export: 'code' } }));
    const htmlToSegments = vi.fn(() => [{ text: 'Wrong parser' }]);
    const input: OutputData = { blocks: [{ id: 'source', type: 'code', data: { code: '<b>literal</b>' } }] };
    const { draft } = planOn(input, [{
      name: 'block.convert', args: { id: 'source', type: 'paragraph' },
    }], { tools, ports: stubPorts({ htmlToSegments }) });

    expect(draft.get('source')?.data.text).toEqual([{ text: '<b>literal</b>' }]);
    expect(htmlToSegments).not.toHaveBeenCalled();
  });

  it('exports rich text into a plain target field without storing segments there', () => {
    const tools = new Map(TOOLS);

    tools.set('code', tool('code', { conversion: { import: 'code', export: 'code' } }));
    const input: OutputData = { blocks: [{
      id: 'source', type: 'paragraph',
      data: { text: [{ text: 'One', marks: { bold: true } }, { text: '\nTwo', marks: { italic: true } }] },
    }] };
    const { draft } = planOn(input, [{
      name: 'block.convert', args: { id: 'source', type: 'code' },
    }], { tools });

    expect(draft.get('source')?.data).toEqual({ code: 'One\nTwo' });
  });

  it('sanitizes an unoverridden target default and the carried rich field', () => {
    const tools = new Map(TOOLS);

    tools.set('prepared-target', tool('prepared-target', {
      richTextFields: ['text'], conversion: { import: 'text', export: 'text' },
      defaultData: { label: '<script>Default' },
    }));
    const sanitizeBlockData = (type: string, data: Record<string, unknown>): Record<string, unknown> => ({
      ...data,
      ...(type === 'prepared-target' && typeof data.label === 'string' ? { label: data.label.replace('<script>', '') } : {}),
      ...(type === 'prepared-target' && isRichText(data.text) ? {
        text: data.text.map(segment => 'text' in segment
          ? { ...segment, text: segment.text.replace('<script>', '') }
          : segment),
      } : {}),
    });
    const input: OutputData = { blocks: [{
      id: 'source', type: 'paragraph', data: { text: [{ text: '<script>Carried', marks: { bold: true } }] },
    }] };
    const { draft, warnings } = planOn(input, [{
      name: 'block.convert', args: { id: 'source', type: 'prepared-target' },
    }], { tools, ports: stubPorts({ sanitizeBlockData }) });

    expect(draft.get('source')?.data).toEqual({ label: 'Default', text: [{ text: 'Carried', marks: { bold: true } }] });
    expect(warnings).toContainEqual(expect.objectContaining({
      code: 'SANITIZED', commandIndex: 0, blockId: 'source', field: 'label',
    }));
    expect(warnings).toContainEqual(expect.objectContaining({
      code: 'SANITIZED', commandIndex: 0, blockId: 'source', field: 'text',
    }));
  });

  it('lets explicit overrides win, then sanitizes the final target data', () => {
    const tools = new Map(TOOLS);

    tools.set('header', tool('header', {
      ...registered('header').entry,
      data: { type: 'object', properties: { text: { type: 'array' }, level: { type: 'integer' }, anchor: { type: 'string' } }, additionalProperties: false },
      defaultData: { text: [], level: 2, anchor: 'Default' },
    }));
    const sanitizeBlockData = (type: string, data: Record<string, unknown>): Record<string, unknown> => ({
      ...data,
      ...(type === 'header' && typeof data.anchor === 'string' ? { anchor: data.anchor.replace('<script>', '') } : {}),
    });
    const { draft, warnings } = planOn(doc, [{
      name: 'block.convert', args: { id: 'a', type: 'header', data: { text: 'Override', level: 4, anchor: '<script>Label' } },
    }], { tools, ports: stubPorts({ sanitizeBlockData }) });

    expect(draft.get('a')?.data).toEqual({ text: [{ text: 'Override' }], level: 4, anchor: 'Label' });
    expect(warnings).toContainEqual(expect.objectContaining({
      code: 'SANITIZED', commandIndex: 0, blockId: 'a', field: 'anchor',
    }));
  });

  it('uses target normalization as the whole record and does not retain omitted defaults', () => {
    const tools = new Map(TOOLS);
    let calls = 0;

    tools.set('header', tool('header', {
      ...registered('header').entry, defaultData: { text: [], level: 2, discarded: 'Default' },
    }, {
      normalize: data => {
        calls += 1;
        if (calls > 1) {
          throw new Error('Normalizer ran twice');
        }

        return { text: data.text, level: 5 };
      },
    }));
    const { draft, plan } = planOn(doc, [{
      name: 'block.convert', args: { id: 'a', type: 'header', data: { level: 4 } },
    }], { tools });

    expect(draft.get('a')?.data).toEqual({ text: [{ text: 'A', marks: { bold: true } }], level: 5 });
    expect(plan.edits).toEqual([{
      op: 'replaceType', id: 'a', type: 'header',
      data: { text: [{ text: 'A', marks: { bold: true } }], level: 5 },
    }]);
    expect(calls).toBe(1);
  });

  it('prepares rich text produced by normalization without normalizing twice', () => {
    const tools = new Map(TOOLS);
    let calls = 0;

    tools.set('header', tool('header', registered('header').entry, {
      normalize: data => {
        calls += 1;
        if (calls > 1) {
          throw new Error('Normalizer ran twice');
        }

        return { ...data, text: 'Normalized' };
      },
    }));
    const { draft } = planOn(doc, [{
      name: 'block.convert', args: { id: 'a', type: 'header', data: { level: 3 } },
    }], { tools });

    expect(draft.get('a')?.data.text).toEqual([{ text: 'Normalized' }]);
    expect(calls).toBe(1);
  });

  const unsupported: Array<{ name: string; source: string; target: string; missing: string[] }> = [
    { name: 'source export', source: 'no-export', target: 'paragraph', missing: ['no-export'] },
    { name: 'target import', source: 'paragraph', target: 'no-import', missing: ['no-import'] },
    { name: 'both sides', source: 'no-export', target: 'no-import', missing: ['no-export', 'no-import'] },
  ];

  it.each(unsupported)('names the missing string conversion fields for $name', ({ source, target, missing }) => {
    const tools = new Map(TOOLS);

    tools.set('no-export', tool('no-export', { conversion: { import: 'text' } }));
    tools.set('no-import', tool('no-import', { conversion: { export: 'text' } }));
    const input: OutputData = { blocks: [{ id: 'source', type: source, data: { text: [] } }] };

    expect(failOf(() => planOn(input, [{
      name: 'block.convert', args: { id: 'source', type: target },
    }], { tools }))).toMatchObject({
      code: 'CONVERSION_UNSUPPORTED', path: '/commands/0/args/type', details: { missing },
    });
  });

  it('refuses an opaque source before attempting conversion', () => {
    expect(failOf(() => planOn(doc, [{
      name: 'block.convert', args: { id: 'kb', type: 'paragraph' },
    }]))).toMatchObject({ code: 'UNKNOWN_TOOL', path: '/commands/0/args/id', details: { opaque: true } });
  });

  it('refuses an unregistered target', () => {
    expect(failOf(() => planOn(doc, [{
      name: 'block.convert', args: { id: 'a', type: 'missing' },
    }]))).toMatchObject({ code: 'UNKNOWN_TOOL', path: '/commands/0/args/type' });
  });

  it('refuses a childless target even when both conversion fields are supported', () => {
    const tools = new Map(TOOLS);

    tools.set('leaf', tool('leaf', {
      richTextFields: ['text'], conversion: { import: 'text', export: 'text' },
      children: { accepts: false, ownedByTool: false, layout: false, deletedWithParent: false },
    }));

    expect(failOf(() => planOn(doc, [{
      name: 'block.convert', args: { id: 'tg', type: 'leaf' },
    }], { tools }))).toMatchObject({
      code: 'PLACEMENT_REFUSED', details: { reason: 'TAKES_NO_CHILDREN' },
    });
  });

  const retainedChildren: Array<{ name: string; allow: string[]; deny: string[] }> = [
    { name: 'allow list', allow: ['header'], deny: [] },
    { name: 'deny over allow', allow: ['paragraph'], deny: ['paragraph'] },
  ];

  it.each(retainedChildren)('refuses retained children excluded by target $name', ({ allow, deny }) => {
    const tools = new Map(TOOLS);

    tools.set('restricted-container', tool('restricted-container', {
      richTextFields: ['text'], conversion: { import: 'text', export: 'text' },
      children: { accepts: true, allow, deny, ownedByTool: false, layout: false, deletedWithParent: false },
    }));

    expect(failOf(() => planOn(doc, [{
      name: 'block.convert', args: { id: 'tg', type: 'restricted-container' },
    }], { tools }))).toMatchObject({
      code: 'PLACEMENT_REFUSED', details: { reason: 'CHILD_NOT_ALLOWED', allowed: allow },
    });
  });

  it('checks the converted type against the parent created by an earlier move', () => {
    const tools = new Map(TOOLS);

    tools.set('paragraphs-only', tool('paragraphs-only', {
      children: { accepts: true, allow: ['paragraph'], ownedByTool: false, layout: false, deletedWithParent: false },
    }));
    const input: OutputData = { blocks: [
      { id: 'a', type: 'paragraph', data: { text: [] } },
      { id: 'frame', type: 'paragraphs-only', data: {} },
    ] };

    expect(failOf(() => planOn(input, [
      { name: 'block.move', args: { id: 'a', parentId: 'frame', position: 'end' } },
      { name: 'block.convert', args: { id: 'a', type: 'header', data: { level: 3 } } },
    ], { tools }))).toMatchObject({
      code: 'PLACEMENT_REFUSED', commandIndex: 1, details: { reason: 'CHILD_NOT_ALLOWED', allowed: ['paragraph'] },
    });
  });

  it('refuses a converted type restricted in the existing table cell', () => {
    const input: OutputData = { blocks: [
      { id: 'table', type: 'table', data: { content: [[{ blocks: ['a'] }]] }, content: ['a'] },
      { id: 'a', type: 'paragraph', data: { text: [] }, parent: 'table' },
    ] };

    expect(failOf(() => planOn(input, [{
      name: 'block.convert', args: { id: 'a', type: 'header', data: { level: 3 } },
    }]))).toMatchObject({
      code: 'PLACEMENT_REFUSED', details: { reason: 'RESTRICTED_IN_CELL' },
    });
  });

  it('permits a guarded caller key authorized by exactly block.convert', () => {
    const tools = new Map(TOOLS);

    tools.set('guarded-target', tool('guarded-target', {
      richTextFields: ['text'], conversion: { import: 'text', export: 'text' },
      guardedFields: { mode: 'block.convert' },
    }));
    const { draft, plan } = planOn(doc, [{
      name: 'block.convert', args: { id: 'a', type: 'guarded-target', data: { mode: true } },
    }], { tools });

    expect(draft.get('a')?.data).toEqual({ text: [{ text: 'A', marks: { bold: true } }], mode: true });
    expect(plan.edits).toEqual([{
      op: 'replaceType', id: 'a', type: 'guarded-target',
      data: { text: [{ text: 'A', marks: { bold: true } }], mode: true },
    }]);
  });

  const unauthorizedGuards: Array<{ use: string; value: boolean | null }> = [
    { use: 'target.setMode', value: true },
    { use: 'block.*', value: null },
    { use: 'block.convert ', value: true },
  ];

  it.each(unauthorizedGuards)('refuses a guarded caller key assigned to "$use"', ({ use, value }) => {
    const tools = new Map(TOOLS);

    tools.set('guarded-target', tool('guarded-target', {
      richTextFields: ['text'], conversion: { import: 'text', export: 'text' },
      guardedFields: { mode: use }, defaultData: { mode: true },
    }));

    expect(failOf(() => planOn(doc, [{
      name: 'block.convert', args: { id: 'a', type: 'guarded-target', data: { mode: value } },
    }], { tools }))).toMatchObject({
      code: 'FIELD_NOT_WRITABLE', path: '/commands/0/args/data/mode',
      details: { reason: 'guarded', field: 'mode', use },
    });
  });

  it('does not treat inherited guarded-field entries as restrictions', () => {
    const tools = new Map(TOOLS);
    const guardedFields: Record<string, string> = {};

    Object.setPrototypeOf(guardedFields, { mode: 'target.setMode' });
    tools.set('guarded-target', tool('guarded-target', {
      richTextFields: ['text'], conversion: { import: 'text', export: 'text' }, guardedFields,
    }));
    const { draft } = planOn(doc, [{
      name: 'block.convert', args: { id: 'a', type: 'guarded-target', data: { mode: false } },
    }], { tools });

    expect(draft.get('a')?.data.mode).toBe(false);
  });

  it('permits normalizer-derived guarded repairs without permitting caller bypass', () => {
    const tools = new Map(TOOLS);

    tools.set('guarded-target', tool('guarded-target', {
      richTextFields: ['text'], conversion: { import: 'text', export: 'text' },
      guardedFields: { mode: 'target.setMode' },
    }, { normalize: data => ({ ...data, mode: true }) }));
    const { draft } = planOn(doc, [{
      name: 'block.convert', args: { id: 'a', type: 'guarded-target' },
    }], { tools });

    expect(draft.get('a')?.data.mode).toBe(true);
  });

  it('refuses malformed rich output from the target normalizer', () => {
    const tools = new Map(TOOLS);

    tools.set('header', tool('header', registered('header').entry, {
      normalize: data => ({ ...data, text: 123 }),
    }));

    expect(failOf(() => planOn(doc, [{
      name: 'block.convert', args: { id: 'a', type: 'header', data: { level: 3 } },
    }], { tools }))).toMatchObject({
      code: 'INVALID_ARGS', path: '/commands/0/args/data/text',
    });
  });

  it.each([1, null])('refuses a caller view-state override even when its value is %s', zoom => {
    const tools = new Map(TOOLS);

    tools.set('preview', tool('preview', {
      richTextFields: ['text'], conversion: { import: 'text', export: 'text' },
      viewState: ['zoom'], defaultData: { zoom: 1 },
    }));

    expect(failOf(() => planOn(doc, [{
      name: 'block.convert', args: { id: 'a', type: 'preview', data: { zoom } },
    }], { tools }))).toMatchObject({
      code: 'FIELD_NOT_WRITABLE', path: '/commands/0/args/data/zoom', details: { reason: 'view-state', field: 'zoom' },
    });
  });

  it('refuses an unchanged legacy view-state key in the whole replacement record', () => {
    const tools = new Map(TOOLS);

    tools.set('preview', tool('preview', {
      richTextFields: ['text'], conversion: { import: 'text', export: 'text' },
      viewState: ['zoom'], defaultData: { zoom: 1 },
    }));
    const input: OutputData = { blocks: [{
      id: 'a', type: 'paragraph', data: { text: [], zoom: 1 },
    }] };

    expect(failOf(() => planOn(input, [{
      name: 'block.convert', args: { id: 'a', type: 'preview' },
    }], { tools }))).toMatchObject({
      code: 'FIELD_NOT_WRITABLE', path: '/commands/0/args/data/zoom',
      details: { reason: 'view-state', field: 'zoom' },
    });
  });

  it('refuses target view state produced by the preparation port', () => {
    const tools = new Map(TOOLS);

    tools.set('preview', tool('preview', {
      richTextFields: ['text'], conversion: { import: 'text', export: 'text' }, viewState: ['zoom'],
    }));
    const sanitizeBlockData = (type: string, data: Record<string, unknown>): Record<string, unknown> => ({
      ...data, ...(type === 'preview' ? { zoom: 1 } : {}),
    });

    expect(failOf(() => planOn(doc, [{
      name: 'block.convert', args: { id: 'a', type: 'preview' },
    }], { tools, ports: stubPorts({ sanitizeBlockData }) }))).toMatchObject({
      code: 'FIELD_NOT_WRITABLE', path: '/commands/0/args/data/zoom',
      details: { reason: 'view-state', field: 'zoom' },
    });
  });

  it('refuses view state newly produced by target normalization', () => {
    const tools = new Map(TOOLS);

    tools.set('preview', tool('preview', {
      richTextFields: ['text'], conversion: { import: 'text', export: 'text' }, viewState: ['zoom'],
    }, { normalize: data => ({ ...data, zoom: 2 }) }));

    expect(failOf(() => planOn(doc, [{
      name: 'block.convert', args: { id: 'a', type: 'preview' },
    }], { tools }))).toMatchObject({
      code: 'FIELD_NOT_WRITABLE', details: { reason: 'view-state', field: 'zoom' },
    });
  });
});

describe('move and convert batch boundaries', () => {
  const existingResults: AgentCommand[] = [
    { name: 'block.move', ref: 'not-created', args: { id: 'a', position: 'start' } },
    { name: 'block.convert', ref: 'not-created', args: { id: 'a', type: 'header', data: { level: 3 } } },
  ];

  it.each(existingResults)('does not publish a creation ref for $name', command => {
    expect(failOf(() => planOn(doc, [command]))).toMatchObject({
      code: 'INVALID_ARGS', commandIndex: 0, path: '/commands/0/ref',
    });
  });

  it('uses the converted type when checking a later move', () => {
    const tools = new Map(TOOLS);

    tools.set('frame', tool('frame', {
      children: { accepts: true, allow: ['paragraph'], ownedByTool: false, layout: false, deletedWithParent: false },
    }));
    const input: OutputData = { blocks: [
      { id: 'a', type: 'paragraph', data: { text: [] } },
      { id: 'frame', type: 'frame', data: {} },
    ] };

    expect(failOf(() => planOn(input, [
      { name: 'block.convert', args: { id: 'a', type: 'header', data: { level: 3 } } },
      { name: 'block.move', args: { id: 'a', parentId: 'frame', position: 'end' } },
    ], { tools }))).toMatchObject({
      code: 'PLACEMENT_REFUSED', commandIndex: 1, details: { reason: 'CHILD_NOT_ALLOWED', allowed: ['paragraph'] },
    });
  });

  it('reserves later effective default IDs after a move changes the sibling destination', () => {
    const tools = new Map(TOOLS);

    tools.set('frame', tool('frame', {
      children: { accepts: true, allow: ['seeded'], ownedByTool: false, layout: false, deletedWithParent: false },
    }));
    tools.set('seeded', tool('seeded', {}, {
      defaultChildren: [{ type: 'paragraph', id: 'n1', data: { text: 'Default' } }],
    }));
    const input: OutputData = { blocks: [
      { id: 'anchor', type: 'seeded', data: {}, content: [] },
      { id: 'frame', type: 'frame', data: {} },
    ] };
    const { draft, plan } = planOn(input, [
      { name: 'block.insert', args: { type: 'paragraph', data: { text: 'Earlier' } } },
      { name: 'block.move', args: { id: 'anchor', parentId: 'frame', position: 'end' } },
      { name: 'block.insert', args: { type: 'paragraph', position: { after: 'anchor' }, demote: true } },
    ], { tools });

    expect(draft.get('n1')?.data.text).toEqual([{ text: 'Default' }]);
    expect(draft.childrenOf('frame')).toEqual(['anchor', 'n3']);
    expect(draft.get('n3')?.type).toBe('seeded');
    expect(draft.childrenOf('n3')).toEqual(['n1']);
    expect(draft.get('n2')?.data.text).toEqual([{ text: 'Earlier' }]);
    expect(draft.childrenOf('anchor')).toEqual([]);
    expect(plan.results).toEqual([
      { id: 'n2', childIds: [] }, { id: 'anchor' }, { id: 'n3', childIds: ['n1'] },
    ]);
  });

  it('reserves later effective default IDs after conversion changes the destination rules', () => {
    const tools = new Map(TOOLS);

    tools.set('frame', tool('frame', {
      richTextFields: ['text'], conversion: { import: 'text', export: 'text' },
      children: { accepts: true, allow: ['seeded'], ownedByTool: false, layout: false, deletedWithParent: false },
    }));
    tools.set('seeded', tool('seeded', {}, {
      defaultChildren: [{ type: 'paragraph', id: 'n1', data: { text: 'Default' } }],
    }));
    const input: OutputData = { blocks: [{ id: 'parent', type: 'paragraph', data: { text: [] } }] };
    const { draft, plan } = planOn(input, [
      { name: 'block.insert', args: { type: 'paragraph', data: { text: 'Earlier' } } },
      { name: 'block.convert', args: { id: 'parent', type: 'frame' } },
      { name: 'block.insert', args: { type: 'paragraph', parentId: 'parent', demote: true } },
    ], { tools });

    expect(draft.get('n1')?.data.text).toEqual([{ text: 'Default' }]);
    expect(draft.get('parent')?.type).toBe('frame');
    expect(draft.childrenOf('parent')).toEqual(['n3']);
    expect(draft.get('n3')?.type).toBe('seeded');
    expect(draft.childrenOf('n3')).toEqual(['n1']);
    expect(draft.get('n2')?.data.text).toEqual([{ text: 'Earlier' }]);
    expect(plan.results).toEqual([
      { id: 'n2', childIds: [] }, { id: 'parent' }, { id: 'n3', childIds: ['n1'] },
    ]);
  });
});
