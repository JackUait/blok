// @vitest-environment node
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { COMMANDS } from '../../../../src/shared/agent/commands';
import { checkEnvelope } from '../../../../src/shared/agent/envelope';
import { AgentFailure } from '../../../../src/shared/agent/errors';
import { validateAgainst } from '../../../../src/shared/schema/validate';
import { coreCommandMap } from './fixtures';

import type {
  JsonSchema, PlannerActionImpl, PlannerCommand, PlannerToolEntry, PlannerToolRuntime, SchemaValidator,
} from '../../../../src/shared/agent/types';
import type { AgentBatch, CoreCommandName } from '../../../../types/agent';
import type { BlockToolManifestEntry, CommandEntry } from '../../../../types/tool-manifest';
import type { BlokSchema, ToolActionContext, ToolActionImpl } from '../../../../types/tools/tool-description';
import type { ToolRuntime } from '../../../../src/shared/tool-actions/runtime';

interface RegistryCase {
  name: CoreCommandName;
  readOnly: boolean;
  valid: [Record<string, unknown>, ...Array<Record<string, unknown>>];
  invalid: Array<Record<string, unknown>>;
}

const registryCases: RegistryCase[] = [
  {
    name: 'doc.read', readOnly: true,
    valid: [{}, { rootId: null, depth: 0, ids: ['a', '$new'], detail: 'full', limit: 1000, cursor: 'next', textLimit: 0 }],
    invalid: [{ detail: 'brief' }, { limit: 0 }, { limit: 1001 }, { depth: -1 }, { textLimit: -1 }, { ids: [7] }],
  },
  {
    name: 'doc.find', readOnly: true,
    valid: [{}, { text: 'hello', type: 'paragraph', rootId: 'a', limit: 1 }],
    invalid: [{ text: '' }, { limit: 0 }, { rootId: null }],
  },
  {
    name: 'doc.setTitle', readOnly: false,
    valid: [{ title: '' }, { title: 'Notes' }],
    invalid: [{}, { title: null }, { title: 7 }],
  },
  {
    name: 'doc.setIcon', readOnly: false,
    valid: [{ icon: null }, { icon: { type: 'emoji', value: '\u{1f4c4}' } }, { icon: { type: 'image', url: 'https://example.com/icon.png' } }],
    invalid: [{}, { icon: 'plain' }, { icon: {} }, { icon: { type: 'emoji' } }, { icon: { type: 'image', value: 'wrong' } }],
  },
  {
    name: 'block.insert', readOnly: false,
    valid: [{ type: 'paragraph' }, { type: 'toggle', id: 'chosen', data: { text: 'hello' }, tunes: {}, parentId: null, position: { after: '$new' }, demote: true, children: [{ type: 'paragraph' }] }],
    invalid: [{}, { type: '' }, { type: 'paragraph', data: [] }, { type: 'paragraph', id: '' }, { type: 'paragraph', demote: 'yes' }, { type: 'paragraph', children: {} }],
  },
  {
    name: 'block.update', readOnly: false,
    valid: [{ id: 'a' }, { id: '$new', data: { old: null, text: 'hello' }, tunes: {} }],
    invalid: [{}, { id: '' }, { id: 7 }, { id: 'a', data: [] }, { id: 'a', tunes: null }],
  },
  {
    name: 'block.delete', readOnly: false,
    valid: [{ id: 'a' }, { id: '$new' }],
    invalid: [{}, { id: '' }, { id: null }],
  },
  {
    name: 'block.move', readOnly: false,
    valid: [{ id: 'a', position: 'start' }, { id: 'a', parentId: null, position: { before: 'b' } }],
    invalid: [{ id: 'a' }, { position: 'end' }, { id: 'a', position: 'middle' }, { id: 'a', parentId: 7, position: 'end' }],
  },
  {
    name: 'block.convert', readOnly: false,
    valid: [{ id: 'a', type: 'header' }, { id: 'a', type: 'header', data: { level: 2 } }],
    invalid: [{ id: 'a' }, { type: 'header' }, { id: 'a', type: '' }, { id: 'a', type: 'header', data: [] }],
  },
  {
    name: 'block.duplicate', readOnly: false,
    valid: [{ id: 'a' }, { id: '$new', position: { after: 'b' } }],
    invalid: [{}, { position: 'end' }, { id: '' }, { id: 'a', position: 'middle' }],
  },
  {
    name: 'text.insert', readOnly: false,
    valid: [{ id: 'a', at: 0, text: '' }, { id: 'a', field: 'text', at: { after: 'needle' }, text: [{ text: 'hello', marks: { bold: true } }], marks: { italic: true } }],
    invalid: [{ id: 'a', text: 'x' }, { id: 'a', at: 0 }, { id: 'a', at: -1, text: 'x' }, { id: 'a', at: 0.5, text: 'x' }, { id: 'a', at: { after: '' }, text: 'x' }, { id: 'a', at: 0, text: [7] }],
  },
  {
    name: 'text.delete', readOnly: false,
    valid: [{ id: 'a', range: 'all' }, { id: 'a', field: 'text', range: { start: 0, end: 2, expectText: 'hi' } }, { id: 'a', range: { find: 'hi', occurrence: 1 } }],
    invalid: [{ id: 'a' }, { range: 'all' }, { id: 'a', range: { start: 0 } }, { id: 'a', range: { find: '' } }, { id: 'a', range: { find: 'x', occurrence: 0 } }],
  },
  {
    name: 'text.replace', readOnly: false,
    valid: [{ id: 'a', with: '' }, { id: 'a', range: 'all', with: [{ embed: { page: { id: 'page-1' } } }] }],
    invalid: [{ id: 'a' }, { with: 'x' }, { id: 'a', with: null }, { id: 'a', with: [7] }, { id: 'a', with: 'x', range: 'none' }],
  },
  {
    name: 'text.format', readOnly: false,
    valid: [{ id: 'a', range: 'all' }, { id: 'a', field: 'text', range: { start: 0, end: 1 }, set: { bold: true }, unset: ['italic', 'tag:custom'] }],
    invalid: [{ id: 'a' }, { range: 'all' }, { id: 'a', range: 'all', set: [] }, { id: 'a', range: 'all', unset: [7] }],
  },
  {
    name: 'markdown.insert', readOnly: false,
    valid: [{ markdown: '' }, { markdown: '# Heading', parentId: null, position: { after: 'a' } }],
    invalid: [{}, { markdown: 7 }, { markdown: 'x', parentId: 7 }, { markdown: 'x', position: 'middle' }],
  },
  {
    name: 'markdown.export', readOnly: true,
    valid: [{}, { rootId: '$new' }],
    invalid: [{ rootId: null }, { rootId: 7 }],
  },
  {
    name: 'history.undo', readOnly: false,
    valid: [{}],
    invalid: [{ id: 'a' }],
  },
  {
    name: 'history.redo', readOnly: false,
    valid: [{}],
    invalid: [{ id: 'a' }],
  },
];

const fails = (
  batch: unknown,
  commands: ReadonlyMap<string, PlannerCommand> = coreCommandMap()
): AgentFailure['error'] => {
  try {
    checkEnvelope(batch, commands, validateAgainst);
  } catch (error) {
    if (error instanceof AgentFailure) {
      return error.error;
    }
    throw error;
  }
  throw new Error('Expected AgentFailure');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const record = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error('Expected schema object');
  }

  return value;
};

const action = (name: string, over: Partial<PlannerCommand> = {}): PlannerCommand => ({
  name,
  args: { type: 'object' },
  readOnly: false,
  available: true,
  source: { tool: 'table', target: 'block' },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('COMMANDS', () => {
  it('exposes exactly the 18 public core command names', () => {
    expect(Object.keys(COMMANDS).sort()).toStrictEqual([
      'block.convert', 'block.delete', 'block.duplicate', 'block.insert', 'block.move', 'block.update',
      'doc.find', 'doc.read', 'doc.setIcon', 'doc.setTitle',
      'history.redo', 'history.undo', 'markdown.export', 'markdown.insert',
      'text.delete', 'text.format', 'text.insert', 'text.replace',
    ]);
  });

  it.each(registryCases)('$name exposes runtime and write metadata', ({ name, readOnly }) => {
    expect(COMMANDS[name]).toMatchObject({ readOnly, runtime: 'any' });
    expect(COMMANDS[name].summary.trim().length).toBeGreaterThan(0);
  });

  it.each(registryCases)('$name accepts its public argument shapes', ({ name, valid }) => {
    for (const args of valid) {
      expect(validateAgainst(COMMANDS[name].argsSchema, args), JSON.stringify(args)).toStrictEqual([]);
    }
  });

  it.each(registryCases)('$name refuses missing or malformed fields', ({ name, invalid }) => {
    for (const args of invalid) {
      expect(validateAgainst(COMMANDS[name].argsSchema, args).length, JSON.stringify(args)).toBeGreaterThan(0);
    }
  });

  it.each(registryCases)('$name refuses undeclared top-level args', ({ name, valid }) => {
    expect(validateAgainst(COMMANDS[name].argsSchema, { ...valid[0], unexpected: true }))
      .toContainEqual({ path: '/unexpected', message: 'unknown field "unexpected"' });
  });

  it('guides plain block insertion toward markdown.insert for Markdown', () => {
    expect(COMMANDS['block.insert'].guidance).toContain('markdown.insert');
    expect(COMMANDS['block.insert'].guidance).toMatch(/segments|plain text/i);
    expect(COMMANDS['block.insert'].guidance).toMatch(/never Markdown/i);
  });

  it('publishes a self-contained recursive InsertSpec without cyclic objects', () => {
    const schema = COMMANDS['block.insert'].argsSchema;
    const serialized: unknown = JSON.parse(JSON.stringify(schema));
    const properties = record(schema.properties);
    const children = record(properties.children);
    const items = record(children.items);
    const reference = items.$ref;

    expect(serialized).toStrictEqual(schema);
    expect(children.type).toBe('array');
    expect(reference).toMatch(/^#\/\$defs\/[^/]+$/);

    if (typeof reference !== 'string' || !reference.startsWith('#/$defs/')) {
      throw new Error('Expected a local InsertSpec reference');
    }

    const definitions = record(schema.$defs);
    const definition = record(definitions[reference.slice('#/$defs/'.length)]);
    const childProperties = record(definition.properties);

    expect(definition).toMatchObject({ type: 'object', required: ['type'], additionalProperties: false });
    expect(Object.keys(childProperties).sort()).toStrictEqual(['children', 'data', 'id', 'tunes', 'type']);
    expect(childProperties.children).toStrictEqual({ type: 'array', items: { $ref: reference } });
    expect(validateAgainst(definition, { type: 'paragraph', id: 'chosen', data: {}, tunes: {} })).toStrictEqual([]);
    expect(validateAgainst(definition, {})).toContainEqual({ path: '', message: 'missing required field "type"' });
    expect(validateAgainst(definition, { type: 'paragraph', parentId: 'foreign' }))
      .toContainEqual({ path: '/parentId', message: 'unknown field "parentId"' });
  });

  it.each(['block.insert', 'block.move', 'block.duplicate', 'markdown.insert'] satisfies CoreCommandName[])(
    '%s accepts each BlockPosition shape and refuses ambiguous placements', name => {
      const blockArgs = name === 'block.insert' ? { type: 'paragraph' } : { id: 'a' };
      const base = name === 'markdown.insert' ? { markdown: 'x' } : blockArgs;

      for (const position of ['start', 'end', { before: 'b' }, { after: '$new' }]) {
        expect(validateAgainst(COMMANDS[name].argsSchema, { ...base, position })).toStrictEqual([]);
      }
      for (const position of [{}, { before: '' }, { before: 'a', after: 'b' }, { after: 'b', extra: true }]) {
        expect(validateAgainst(COMMANDS[name].argsSchema, { ...base, position }).length).toBeGreaterThan(0);
      }
    }
  );

  it.each(['text.delete', 'text.replace', 'text.format'] satisfies CoreCommandName[])(
    '%s refuses invalid TextRange bounds and extra range fields', name => {
      const base = name === 'text.replace' ? { id: 'a', with: 'x' } : { id: 'a' };

      for (const range of [
        { start: -1, end: 1 }, { start: 0.5, end: 1 }, { start: 0, end: -1 },
        { start: 0, end: 1, expectText: 7 }, { find: 'x', occurrence: 0.5 }, { find: 'x', extra: true },
      ]) {
        expect(validateAgainst(COMMANDS[name].argsSchema, { ...base, range }).length).toBeGreaterThan(0);
      }
    }
  );
});

describe('planner type compatibility', () => {
  it('uses the canonical action implementation and context types', () => {
    const canonical: ToolActionImpl = { run: (ctx: ToolActionContext): unknown => ctx.tool };
    const runtime: PlannerToolRuntime = { actions: { inspect: canonical } };
    const roundTrip: ToolActionImpl | undefined = runtime.actions.inspect;

    expect(roundTrip).toBe(canonical);
    expectTypeOf<PlannerActionImpl>().toEqualTypeOf<ToolActionImpl>();
    expectTypeOf<PlannerActionImpl['prepare']>().toEqualTypeOf<ToolActionImpl['prepare']>();
    expectTypeOf<Parameters<PlannerActionImpl['run']>[0]>().toEqualTypeOf<ToolActionContext>();
    expectTypeOf<PlannerToolRuntime['actions'][string]>().toEqualTypeOf<ToolActionImpl>();
    expectTypeOf<ToolRuntime>().toExtend<PlannerToolRuntime>();
  });

  it('accepts the published manifest, command and validator shapes without casts', () => {
    expectTypeOf<BlokSchema>().toEqualTypeOf<JsonSchema>();
    expectTypeOf<CommandEntry>().toExtend<PlannerCommand>();
    expectTypeOf<BlockToolManifestEntry>().toExtend<PlannerToolEntry>();
    expectTypeOf<typeof validateAgainst>().toEqualTypeOf<SchemaValidator>();
  });
});

describe('checkEnvelope', () => {
  it.each([
    { label: 'undefined batch', batch: undefined }, { label: 'null batch', batch: null },
    { label: 'number batch', batch: 7 }, { label: 'string batch', batch: 'commands' },
    { label: 'array batch', batch: [] }, { label: 'missing commands', batch: {} },
    { label: 'null commands', batch: { commands: null } },
    { label: 'object commands', batch: { commands: {} } },
    { label: 'empty commands', batch: { commands: [] } },
  ])('refuses $label at /commands', ({ batch }) => {
    expect(fails(batch)).toMatchObject({ code: 'INVALID_ARGS', path: '/commands', retryable: false });
  });

  it.each([0, 1])('refuses a sparse command array with a hole at index %s', index => {
    const commands: unknown[] = Array<unknown>(2);

    commands[index === 0 ? 1 : 0] = { name: 'doc.read', args: {} };

    expect(fails({ commands })).toMatchObject({ code: 'INVALID_ARGS', commandIndex: index, path: `/commands/${index}` });
  });

  it('refuses an array containing only an empty slot', () => {
    expect(fails({ commands: Array<unknown>(1) }))
      .toMatchObject({ code: 'INVALID_ARGS', commandIndex: 0, path: '/commands/0' });
  });

  it.each([
    { label: 'null command', command: null }, { label: 'array command', command: [] },
    { label: 'number command', command: 7 }, { label: 'missing name', command: { args: {} } },
    { label: 'non-string name', command: { name: 7, args: {} } },
    { label: 'missing args', command: { name: 'doc.read' } },
    { label: 'null args', command: { name: 'doc.read', args: null } },
    { label: 'array args', command: { name: 'doc.read', args: [] } },
    { label: 'number args', command: { name: 'doc.read', args: 7 } },
    { label: 'non-string ref', command: { name: 'doc.read', args: {}, ref: 7 } },
    { label: 'null ref', command: { name: 'doc.read', args: {}, ref: null } },
  ])('refuses $label and retains index zero', ({ command }) => {
    expect(fails({ commands: [command] }))
      .toMatchObject({ code: 'INVALID_ARGS', commandIndex: 0, path: '/commands/0', retryable: false });
  });

  it.each([[null], [7], [false], [{}], [[]]])('refuses a non-string expectRevision %j', expectRevision => {
    expect(fails({ commands: [{ name: 'doc.read', args: {} }], expectRevision }))
      .toMatchObject({ code: 'INVALID_ARGS', path: '/expectRevision' });
  });

  it.each(['', 'opaque:revision'])('preserves the string revision "%s" and a command ref', expectRevision => {
    const batch: AgentBatch = { commands: [{ name: 'block.insert', args: { type: 'paragraph' }, ref: 'new' }], expectRevision };

    expect(checkEnvelope(batch, coreCommandMap(), validateAgainst)).toStrictEqual({ batch, writes: true });
  });

  it('omits absent optional fields in the checked batch', () => {
    expect(checkEnvelope({ commands: [{ name: 'doc.read', args: {} }] }, coreCommandMap(), validateAgainst))
      .toStrictEqual({ batch: { commands: [{ name: 'doc.read', args: {} }] }, writes: false });
  });

  it.each(['caret.set', 'tool.action', 'missing.run', '', 'doc', '.read', 'doc.'])(
    'refuses unregistered "%s" and guides the caller to describe()', name => {
      const error = fails({ commands: [{ name, args: {} }] });

      expect(error).toMatchObject({ code: 'UNKNOWN_COMMAND', commandIndex: 0, path: '/commands/0/name' });
      expect(error.message).toContain(name);
      expect(error.message).toContain('describe()');
      expect(error).not.toHaveProperty('details');
    }
  );

  it('keeps hidden actions unknown even when their tool has other commands', () => {
    const commands = coreCommandMap();

    commands.set('table.create', action('table.create', { source: { tool: 'table', target: 'create' } }));
    commands.set('table.insertRows', action('table.insertRows'));
    commands.set('unrelated.inspect', action('unrelated.inspect', { source: { tool: 'unrelated', target: 'block' } }));

    const error = fails({ commands: [{ name: 'table.hidden', args: {} }] }, commands);

    expect(error).toMatchObject({
      code: 'UNKNOWN_COMMAND', commandIndex: 0, path: '/commands/0/name',
      details: { tool: 'table', actions: ['table.create', 'table.insertRows'] },
    });
    expect(error.message).toContain('table.create');
    expect(error.message).toContain('table.insertRows');
    expect(error.message).not.toContain('unrelated.inspect');
  });

  it('does not invent a tool action list from core or another tool source', () => {
    const commands = coreCommandMap();

    commands.set('table.falseFriend', action('table.falseFriend', { source: { tool: 'other', target: 'block' } }));

    expect(fails({ commands: [{ name: 'table.missing', args: {} }] }, commands)).not.toHaveProperty('details');
    expect(fails({ commands: [{ name: 'block.missing', args: {} }] }, commands)).not.toHaveProperty('details');
  });

  it('reports required args at the validator root pointer', () => {
    expect(fails({ commands: [{ name: 'block.delete', args: {} }] }))
      .toMatchObject({ code: 'INVALID_ARGS', commandIndex: 0, path: '/commands/0/args' });
  });

  it('reports the first real validator problem and keeps all problems in details', () => {
    const error = fails({ commands: [{ name: 'block.update', args: { id: 7, extra: true } }] });

    expect(error).toMatchObject({ code: 'INVALID_ARGS', commandIndex: 0, path: '/commands/0/args/id' });
    expect(error.details).toStrictEqual({ problems: [
      { path: '/id', message: 'expected string, got integer' },
      { path: '/extra', message: 'unknown field "extra"' },
    ] });
  });

  it('retains escaped JSON pointers from a tool action schema', () => {
    const commands = coreCommandMap();

    commands.set('table.inspect', action('table.inspect', {
      args: { type: 'object', properties: { 'a/b~c': { type: 'string' } }, additionalProperties: false },
    }));

    expect(fails({ commands: [{ name: 'table.inspect', args: { 'a/b~c': 7 } }] }, commands))
      .toMatchObject({ code: 'INVALID_ARGS', path: '/commands/0/args/a~1b~0c' });
  });

  it('validates later commands before accepting the batch', () => {
    expect(fails({ commands: [{ name: 'doc.read', args: {} }, { name: 'block.delete', args: { id: 7 } }] }))
      .toMatchObject({ code: 'INVALID_ARGS', commandIndex: 1, path: '/commands/1/args/id' });
  });

  it.each(['runtime', 'service'] satisfies Array<'runtime' | 'service'>)(
    'preserves a listed command unavailable for %s', reason => {
      const commands = coreCommandMap({ 'history.undo': reason });

      expect(fails({ commands: [{ name: 'history.undo', args: {} }] }, commands)).toMatchObject({
        code: 'COMMAND_UNAVAILABLE', commandIndex: 0, path: '/commands/0/name', details: { reason },
      });
    }
  );

  it('includes service requirements only when provided', () => {
    const commands = coreCommandMap();

    commands.set('page.rename', action('page.rename', {
      available: false, unavailableReason: 'service', requires: ['pageBackend'],
      source: { tool: 'page', target: 'block' },
    }));

    expect(fails({ commands: [{ name: 'page.rename', args: {} }] }, commands).details)
      .toStrictEqual({ reason: 'service', requires: ['pageBackend'] });
    expect(fails({ commands: [{ name: 'history.undo', args: {} }] }, coreCommandMap({ 'history.undo': 'runtime' })).details)
      .toStrictEqual({ reason: 'runtime' });
  });

  it('does not fabricate runtime for an unavailable row with no reason', () => {
    const commands = coreCommandMap();

    commands.set('table.inspect', action('table.inspect', { available: false }));

    const error = fails({ commands: [{ name: 'table.inspect', args: {} }] }, commands);

    expect(error).toMatchObject({ code: 'COMMAND_UNAVAILABLE', commandIndex: 0, path: '/commands/0/name' });
    expect(error.details ?? {}).not.toHaveProperty('reason');
    expect(error.details ?? {}).not.toHaveProperty('requires');
  });

  it('preserves explicitly present requirements without inventing a reason', () => {
    const commands = coreCommandMap();

    commands.set('table.inspect', action('table.inspect', { available: false, requires: [] }));

    const error = fails({ commands: [{ name: 'table.inspect', args: {} }] }, commands);

    expect(error.details ?? {}).not.toHaveProperty('reason');
    expect(error.details).toMatchObject({ requires: [] });
  });

  it.each(['history.undo', 'history.redo', 'page.rename'])('%s is allowed alone', name => {
    const commands = coreCommandMap();

    commands.set('page.rename', action('page.rename', { effects: 'host', source: { tool: 'page', target: 'block' } }));

    expect(checkEnvelope({ commands: [{ name, args: {} }] }, commands, validateAgainst).writes).toBe(true);
  });

  it.each([
    { name: 'history.undo', index: 0 }, { name: 'history.undo', index: 1 },
    { name: 'history.redo', index: 0 }, { name: 'history.redo', index: 1 },
    { name: 'page.rename', index: 0 }, { name: 'page.rename', index: 1 },
  ])('refuses $name mixed with reads at index $index', ({ name, index }) => {
    const commands = coreCommandMap();
    const exclusive = { name, args: {} };
    const read = { name: 'doc.read', args: {} };

    commands.set('page.rename', action('page.rename', { effects: 'host', source: { tool: 'page', target: 'block' } }));

    expect(fails({ commands: index === 0 ? [exclusive, read] : [read, exclusive] }, commands))
      .toMatchObject({ code: 'INVALID_ARGS', commandIndex: index, path: `/commands/${index}/name` });
  });

  it('reports writes=false for a batch of all available read commands', () => {
    expect(checkEnvelope({ commands: [
      { name: 'doc.read', args: {} }, { name: 'doc.find', args: { text: 'needle' } }, { name: 'markdown.export', args: {} },
    ] }, coreCommandMap(), validateAgainst).writes).toBe(false);
  });

  it.each([0, 1])('reports writes=true when a core write is at index %s', index => {
    const read = { name: 'doc.read', args: {} };
    const write = { name: 'block.delete', args: { id: 'a' } };

    expect(checkEnvelope({ commands: index === 0 ? [write, read] : [read, write] }, coreCommandMap(), validateAgainst).writes)
      .toBe(true);
  });

  it('derives writes from the registered tool row, not its name', () => {
    const commands = coreCommandMap();

    commands.set('custom.read', action('custom.read', { source: { tool: 'custom', target: 'block' } }));

    expect(checkEnvelope({ commands: [{ name: 'custom.read', args: {} }] }, commands, validateAgainst).writes).toBe(true);
  });

  it('preserves a frozen batch, registry entries and schemas on success', () => {
    const schema: JsonSchema = Object.freeze({
      type: 'object', properties: Object.freeze({ value: Object.freeze({ type: 'string' }) }),
      required: Object.freeze(['value']), additionalProperties: false,
    });
    const entry = Object.freeze(action('table.inspect', { args: schema }));
    const commands = new Map<string, PlannerCommand>([['table.inspect', entry]]);
    const args = Object.freeze({ value: 'unchanged' });
    const command = Object.freeze({ name: 'table.inspect', args, ref: 'inspection' });
    const batch = Object.freeze({ commands: Object.freeze([command]), expectRevision: 'r' });
    const before = JSON.stringify({ batch, entries: [...commands], schema });

    expect(checkEnvelope(batch, commands, validateAgainst)).toStrictEqual({
      batch: { commands: [{ name: 'table.inspect', args: { value: 'unchanged' }, ref: 'inspection' }], expectRevision: 'r' },
      writes: true,
    });
    expect(JSON.stringify({ batch, entries: [...commands], schema })).toBe(before);
    expect(commands.get('table.inspect')).toBe(entry);
  });

  it('does not mutate supplied arguments or schemas on failure', () => {
    const args = Object.freeze({ id: 7 });
    const batch = Object.freeze({ commands: Object.freeze([Object.freeze({ name: 'block.delete', args })]) });
    const commands = coreCommandMap();
    const before = JSON.stringify({ batch, entries: [...commands], schemas: COMMANDS });

    expect(fails(batch, commands)).toMatchObject({ code: 'INVALID_ARGS', path: '/commands/0/args/id' });
    expect(JSON.stringify({ batch, entries: [...commands], schemas: COMMANDS })).toBe(before);
  });
});
