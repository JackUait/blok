import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentError, AgentResult } from '../../../types/agent';

import { renderAgentTools, TOOL_NAME_PATTERN, type RenderedTool, type RenderOptions } from '../../../src/agent/render-tools';
import { validateAgainst } from '../../../src/shared/schema/validate';
import { isClosedSchema } from '../../../src/agent/schema-walk';
import { command, deepFreeze, makeContract } from './fixtures/contract';

type Schema = Record<string, unknown>;
const PROVIDERS: Array<RenderOptions['format']> = ['anthropic', 'openai'];

const isSchema = (value: unknown): value is Schema =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const schema = (value: unknown): Schema => {
  if (!isSchema(value)) {
    throw new Error('Expected a schema object');
  }

  return value;
};

const schemaList = (value: unknown): Schema[] => {
  if (!Array.isArray(value)) {
    throw new Error('Expected schema branches');
  }

  const entries: unknown[] = value;

  return entries.map(schema);
};

const inputOf = (tool: RenderedTool): Schema => {
  if ('input_schema' in tool) {
    return schema(tool.input_schema);
  }

  return schema('parameters' in tool ? tool.parameters : tool.inputSchema);
};

const byName = (tools: RenderedTool[], name: string): RenderedTool => {
  const found = tools.find(tool => tool.name === name);

  if (found === undefined) {
    throw new Error(`No tool ${name}`);
  }

  return found;
};

const propertiesOf = (value: Schema): Schema => schema(value.properties);
const executeItems = (tool: RenderedTool): Schema =>
  schema(schema(propertiesOf(inputOf(tool)).commands).items);

describe('renderAgentTools envelope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(PROVIDERS)('%s renders exactly three legal core names', format => {
    const tools = renderAgentTools(makeContract(), { format });

    expect(tools.map(tool => tool.name)).toEqual(['blok_read', 'blok_describe', 'blok_execute']);
    tools.forEach(tool => expect(tool.name).toMatch(TOOL_NAME_PATTERN));
  });

  it.each(PROVIDERS)('%s keeps input alternatives below the object root', format => {
    renderAgentTools(makeContract(), { format }).forEach(tool => {
      const root = inputOf(tool);

      expect(root).toHaveProperty('type', 'object');
      expect(root).not.toHaveProperty('oneOf');
      expect(root).not.toHaveProperty('anyOf');
    });
  });

  it('renders Anthropic input_schema without a non-strict flag', () => {
    const tool = byName(renderAgentTools(makeContract(), { format: 'anthropic' }), 'blok_read');

    expect(Object.keys(tool).sort()).toEqual(['description', 'input_schema', 'name']);
  });

  it('renders flat OpenAI Responses functions with explicit strict:false', () => {
    renderAgentTools(makeContract(), { format: 'openai' }).forEach(tool => {
      expect(tool).toMatchObject({ type: 'function', strict: false });
      expect(Object.keys(tool).sort()).toEqual(['description', 'name', 'parameters', 'strict', 'type']);
    });
  });

  it('keeps available commands in contract order and args open', () => {
    const contract = makeContract([
      command('zeta.run', { type: 'object' }),
      command('hidden.run', { type: 'object' }, { available: false }),
      command('alpha.run', { type: 'object' }),
    ]);
    const items = executeItems(byName(renderAgentTools(contract, { format: 'anthropic' }), 'blok_execute'));

    expect(schema(propertiesOf(items).name).enum).toEqual(['zeta.run', 'alpha.run']);
    expect(propertiesOf(items).args).toEqual({ type: 'object' });
    expect(propertiesOf(items).ref).toEqual({ type: 'string' });
    expect(items.required).toEqual(['name', 'args']);
  });

  it('requires a nonempty commands array but not expectRevision', () => {
    const root = inputOf(byName(renderAgentTools(makeContract(), { format: 'anthropic' }), 'blok_execute'));

    expect(Object.keys(propertiesOf(root)).sort()).toEqual(['commands', 'expectRevision']);
    expect(schema(propertiesOf(root).commands)).toMatchObject({ type: 'array', minItems: 1 });
    expect(root.required).toEqual(['commands']);
  });

  it('uses doc.read args and optional describe queries', () => {
    const tools = renderAgentTools(makeContract(), { format: 'anthropic' });

    expect(inputOf(byName(tools, 'blok_read'))).toEqual({
      type: 'object',
      properties: { depth: { type: 'integer' } },
      additionalProperties: false,
    });
    expect(inputOf(byName(tools, 'blok_describe'))).toEqual({
      type: 'object',
      properties: { tool: { type: 'string' }, command: { type: 'string' } },
      additionalProperties: false,
    });
  });

  it('uses a closed empty read input if doc.read is absent', () => {
    expect(inputOf(byName(renderAgentTools(makeContract([]), { format: 'anthropic' }), 'blok_read')))
      .toEqual({ type: 'object', properties: {}, additionalProperties: false });
  });

  it.each(PROVIDERS)('%s does not mutate frozen inputs', format => {
    const contract = makeContract();
    const before = JSON.stringify(contract);

    renderAgentTools(deepFreeze(contract), { format });

    expect(JSON.stringify(contract)).toBe(before);
  });

  it('output edits do not change command schemas', () => {
    const contract = makeContract();
    const before = JSON.stringify(contract);
    const read = inputOf(byName(renderAgentTools(contract, { format: 'openai' }), 'blok_read'));

    schema(propertiesOf(read).depth).type = 'string';

    expect(JSON.stringify(contract)).toBe(before);
  });
});

describe('renderAgentTools strict', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Anthropic marks closed read and describe schemas strict when requested', () => {
    const tools = renderAgentTools(makeContract(), { format: 'anthropic', strict: true });

    expect(byName(tools, 'blok_read')).toHaveProperty('strict', true);
    expect(byName(tools, 'blok_describe')).toHaveProperty('strict', true);
    expect(byName(tools, 'blok_execute')).not.toHaveProperty('strict');
  });

  it.each(PROVIDERS)('%s rejects an open nested read object when strict is requested', format => {
    const contract = makeContract([command('doc.read', {
      type: 'object',
      properties: { where: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
      required: ['where'],
      additionalProperties: false,
    })]);

    expect(() => renderAgentTools(contract, { format, strict: true }))
      .toThrowError(expect.objectContaining({ name: 'AgentToolsStrictError', tool: 'blok_read' }));
  });

  it('OpenAI rejects optional properties rather than changing omission into null', () => {
    const contract = deepFreeze(makeContract());
    const before = JSON.stringify(contract);

    expect(() => renderAgentTools(contract, { format: 'openai', strict: true }))
      .toThrowError(expect.objectContaining({
        name: 'AgentToolsStrictError',
        tool: 'blok_read',
        reason: expect.stringMatching(/required/i),
      }));
    expect(JSON.stringify(contract)).toBe(before);
  });

  it('OpenAI proves all required read fields before rejecting optional describe fields', () => {
    const contract = makeContract([command('doc.read', {
      type: 'object',
      properties: { depth: { type: 'integer' } },
      required: ['depth'],
      additionalProperties: false,
    })]);

    expect(() => renderAgentTools(contract, { format: 'openai', strict: true }))
      .toThrowError(expect.objectContaining({ name: 'AgentToolsStrictError', tool: 'blok_describe' }));
  });

  it('OpenAI checks required keys inside definitions and array items', () => {
    const contract = makeContract([command('doc.read', {
      type: 'object',
      properties: { rows: { type: 'array', items: { $ref: '#/$defs/Row' } } },
      required: ['rows'],
      additionalProperties: false,
      $defs: {
        Row: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: [],
          additionalProperties: false,
        },
      },
    })]);

    expect(() => renderAgentTools(contract, { format: 'openai', strict: true }))
      .toThrowError(expect.objectContaining({ name: 'AgentToolsStrictError', tool: 'blok_read' }));
  });

  it('an open nullable object is not closed', () => {
    expect(isClosedSchema({ type: ['object', 'null'] })).toBe(false);
    expect(isClosedSchema({ type: ['object', 'null'], additionalProperties: false })).toBe(true);
  });

  it('checks schema nodes in properties, items, alternatives and definitions', () => {
    const nested: Schema[] = [
      { type: 'object', properties: { child: { type: 'object' } }, additionalProperties: false },
      { type: 'array', items: { type: 'object' } },
      { anyOf: [{ type: 'string' }, { type: 'object' }] },
      { oneOf: [{ type: 'object' }] },
      { allOf: [{ type: 'object' }] },
      { $defs: { Child: { type: 'object' } } },
    ];

    nested.forEach(value => expect(isClosedSchema(value)).toBe(false));
  });

  it('does not mistake enum, const, default or examples data for schemas', () => {
    const data = { type: 'object', properties: { ignored: { type: 'object' } } };
    const literal: Schema = {
      type: 'object',
      properties: { value: { enum: [data], const: data, default: data, examples: [data] } },
      additionalProperties: false,
    };

    expect(isClosedSchema(literal)).toBe(true);
  });

  it('checks repeated shared schemas without treating sharing as recursion', () => {
    const child: Schema = { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false };
    const root = { type: 'object', properties: { left: child, right: child }, additionalProperties: false };

    expect(isClosedSchema(root)).toBe(true);
    child.additionalProperties = true;
    expect(isClosedSchema(root)).toBe(false);
  });

  it.each(PROVIDERS)('%s never makes execute strict in either schema mode', format => {
    const modes: Array<RenderOptions['schema']> = ['envelope', 'full'];

    modes.forEach(mode => {
      const tools = renderAgentTools(makeContract(), { format, schema: mode, strict: format === 'anthropic' });
      const execute = byName(tools, 'blok_execute');

      if (format === 'openai') {
        expect(execute).toHaveProperty('strict', false);
      } else {
        expect(execute).not.toHaveProperty('strict');
      }
    });
  });
});

describe('renderAgentTools full', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fullInput = (contract = makeContract(), format: RenderOptions['format'] = 'anthropic'): Schema =>
    inputOf(byName(renderAgentTools(contract, { format, schema: 'full' }), 'blok_execute'));
  const branchesOf = (root: Schema): Schema[] =>
    schemaList(schema(schema(propertiesOf(root).commands).items).oneOf);

  it('has one closed branch for each available command', () => {
    const branches = branchesOf(fullInput());

    expect(branches.map(branch => schema(propertiesOf(branch).name).const))
      .toEqual(['block.insert', 'doc.read', 'poll.addOption', 'table.insertRows']);
    branches.forEach(branch => {
      expect(branch.additionalProperties).toBe(false);
      expect(branch.required).toEqual(['name', 'args']);
      expect(propertiesOf(branch).ref).toEqual({ type: 'string' });
    });
  });

  it('hoists recursive definitions using the established command prefix', () => {
    const root = fullInput(deepFreeze(makeContract()), 'openai');
    const defs = schema(root.$defs);
    const insert = branchesOf(root).find(branch => schema(propertiesOf(branch).name).const === 'block.insert');

    if (insert === undefined) {
      throw new Error('Missing insert branch');
    }

    expect(Object.keys(defs)).toEqual(['block_insert__InsertSpec']);
    expect(schema(propertiesOf(insert).args)).not.toHaveProperty('$defs');
    expect(JSON.stringify(propertiesOf(insert).args)).toContain('#/$defs/block_insert__InsertSpec');
    expect(JSON.stringify(defs)).not.toContain('"#/$defs/InsertSpec"');
    expect(() => JSON.stringify(root)).not.toThrow();
  });

  it('keeps colliding legal command prefixes linked to their own definitions', () => {
    const args = (value: string): Schema => ({
      type: 'object',
      properties: { value: { $ref: '#/$defs/Value' } },
      $defs: { Value: { type: 'string', const: value } },
    });
    const contract = deepFreeze(makeContract([
      command('a.b_c', args('first')),
      command('a_b.c', args('second')),
      command('a.b_c__2', args('third')),
    ]));
    const before = JSON.stringify(contract);
    const root = fullInput(contract);
    const defs = schema(root.$defs);
    const branches = branchesOf(root);
    const refs = branches.map(branch => {
      const reference = schema(propertiesOf(schema(propertiesOf(branch).args)).value).$ref;

      if (typeof reference !== 'string') {
        throw new Error('Missing local reference');
      }

      return reference;
    });

    expect(new Set(refs).size).toBe(3);
    expect(refs.map(reference => schema(defs[reference.slice('#/$defs/'.length)]).const))
      .toEqual(['first', 'second', 'third']);
    expect(refs[0]).toBe('#/$defs/a_b_c__Value');
    expect(JSON.stringify(contract)).toBe(before);
  });

  it('preserves pointer suffixes while rewriting escaped definition names', () => {
    const contract = makeContract([command('custom.run', {
      type: 'object',
      properties: { value: { $ref: '#/$defs/A~1B/properties/value' } },
      $defs: { 'A/B': { type: 'object', properties: { value: { type: 'string' } } } },
    })]);
    const root = fullInput(contract);
    const args = schema(propertiesOf(schemaList(schema(schema(propertiesOf(root).commands).items).oneOf)[0] ?? {}).args);

    expect(schema(propertiesOf(args).value).$ref).toBe('#/$defs/custom_run__A~1B/properties/value');
    expect(schema(root.$defs)).toHaveProperty('custom_run__A/B');
  });

  it('preserves full-schema input without changing the source contract', () => {
    const contract = deepFreeze(makeContract());
    const before = JSON.stringify(contract);

    fullInput(contract);

    expect(JSON.stringify(contract)).toBe(before);
  });

  const formats: Array<RenderOptions['format']> = ['anthropic', 'openai', 'mcp'];

  it.each(formats)('%s accepts exactly 5000 rendered properties and rejects 5001', format => {
    const args = (count: number): Schema => ({
      type: 'object',
      properties: Object.fromEntries(Array.from({ length: count }, (_, index) => [`p${index}`, { type: 'string' }])),
    });
    const at = makeContract([command('wide.run', args(4995))]);
    const over = makeContract([command('wide.run', args(4996))]);

    expect(() => fullInput(at, format)).not.toThrow();
    expect(() => fullInput(over, format))
      .toThrowError(expect.objectContaining({ name: 'AgentToolsTooLargeError', limit: 'properties', actual: 5001 }));
  });

  it.each(formats)('%s accepts depth 10 with wrapper overhead and rejects depth 11', format => {
    const nested = (count: number): Schema => count === 0
      ? { type: 'string' }
      : { type: 'object', properties: { child: nested(count - 1) } };

    expect(() => fullInput(makeContract([command('deep.run', nested(8))]), format)).not.toThrow();
    expect(() => fullInput(makeContract([command('deep.run', nested(9))]), format))
      .toThrowError(expect.objectContaining({ name: 'AgentToolsTooLargeError', limit: 'depth', actual: 11 }));
  });

  it.each(formats)('%s accepts exactly 1000 enum values and rejects 1001', format => {
    const args = (count: number): Schema => ({
      type: 'object',
      properties: { value: { enum: Array.from({ length: count }, (_, index) => `v${index}`) } },
    });

    expect(() => fullInput(makeContract([command('enum.run', args(1000))]), format)).not.toThrow();
    expect(() => fullInput(makeContract([command('enum.run', args(1001))]), format))
      .toThrowError(expect.objectContaining({ name: 'AgentToolsTooLargeError', limit: 'enumValues', actual: 1001 }));
  });

  it('counts repeated shared schemas at every rendered location', () => {
    const shared = {
      type: 'object',
      properties: Object.fromEntries(Array.from({ length: 2497 }, (_, index) => [`p${index}`, { type: 'string' }])),
    };
    const args = { type: 'object', properties: { left: shared, right: shared } };

    expect(() => fullInput(makeContract([command('shared.run', args)])))
      .toThrowError(expect.objectContaining({ name: 'AgentToolsTooLargeError', limit: 'properties', actual: 5001 }));
  });

  it('envelope ignores unused command schema size', () => {
    const huge = {
      type: 'object',
      properties: Object.fromEntries(Array.from({ length: 6000 }, (_, index) => [`p${index}`, { type: 'string' }])),
    };

    expect(() => renderAgentTools(makeContract([command('wide.run', huge)]), { format: 'openai' })).not.toThrow();
  });

  it('rejects an object schema cycle with a controlled JSON error', () => {
    const properties: Schema = {};
    const cyclic = { type: 'object', properties };

    properties.self = cyclic;

    expect(() => fullInput(makeContract([command('cyclic.run', cyclic)]))).toThrowError(TypeError);
  });

  it('rejects cyclic schema arrays without overflowing', () => {
    const alternatives: unknown[] = [];
    const cyclic = { oneOf: alternatives };

    alternatives.push(cyclic);

    expect(() => fullInput(makeContract([command('cyclic.run', cyclic)]))).toThrowError(TypeError);
  });

  it('rejects a cyclic read schema even in envelope mode', () => {
    const properties: Schema = {};
    const cyclic = { type: 'object', properties };

    properties.self = cyclic;

    expect(() => renderAgentTools(makeContract([command('doc.read', cyclic)]), { format: 'anthropic' }))
      .toThrowError(TypeError);
  });

  it('does not return non-JSON schema values', () => {
    const invalid: unknown[] = [undefined, Number.NaN, Number.POSITIVE_INFINITY, () => 'value'];

    invalid.forEach(value => {
      expect(() => fullInput(makeContract([command('invalid.run', { type: 'object', default: value })])))
        .toThrowError(TypeError);
    });
  });
});

describe('renderAgentTools MCP', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mcp = (handle = false): RenderedTool[] => renderAgentTools(makeContract(), { format: 'mcp', handle });
  const outputOf = (tool: RenderedTool): Schema => {
    if (!('outputSchema' in tool)) {
      throw new Error('Missing MCP output schema');
    }

    return schema(tool.outputSchema);
  };
  const error: AgentError = { code: 'UNKNOWN_HANDLE', message: 'Unknown handle', retryable: false };
  const delivery = { durable: false, pending: false, serverSequence: null, savedVersion: null };

  it('has exactly the MCP shape and omits strict even when requested', () => {
    renderAgentTools(makeContract(), { format: 'mcp', strict: true }).forEach(tool => {
      expect(Object.keys(tool).sort()).toEqual(['description', 'inputSchema', 'name', 'outputSchema']);
    });
  });

  it.each(['blok_read', 'blok_describe'])('%s keeps its broad success disjoint from bare errors', name => {
    const output = outputOf(byName(mcp(), name));
    const branches = schemaList(output.oneOf);
    const [success, failure] = branches;

    if (success === undefined || failure === undefined) {
      throw new Error('Missing result branch');
    }

    expect(schemaList(success.allOf)[1]).toEqual({ not: { required: ['error'] } });
    expect(output.type).toBe('object');
    expect(branches).toHaveLength(2);
    expect(failure).toMatchObject({ type: 'object', required: ['error'], additionalProperties: false });
    expect(validateAgainst(failure, { error })).toEqual([]);
    expect(validateAgainst(failure, { error, delivery })).not.toEqual([]);
  });

  it('excludes errors from the read-success fallback when doc.read is absent', () => {
    const tools = renderAgentTools(makeContract([]), { format: 'mcp' });
    const branches = schemaList(outputOf(byName(tools, 'blok_read')).oneOf);
    const success = branches[0];

    if (success === undefined) {
      throw new Error('Missing read success');
    }

    expect(success).toEqual({ allOf: [{ type: 'object' }, { not: { required: ['error'] } }] });
  });

  it('execute validates canonical success and failure with required delivery on both', () => {
    const output = outputOf(byName(mcp(), 'blok_execute'));
    const success: AgentResult = {
      ok: true,
      revision: 'rev-2',
      results: [{ id: 'created' }],
      refs: { created: 'id-1' },
      changed: { created: ['id-1'], updated: [], moved: [], removed: [] },
      warnings: [],
      lastRange: { blockId: 'id-1', field: 'text', start: 0, end: 3 },
    };
    const failure: AgentResult = { ok: false, error, warnings: [] };

    expect(validateAgainst(output, { ...failure, delivery })).toEqual([]);
    expect(validateAgainst(output, { ...success, delivery })).toEqual([]);
    expect(validateAgainst(output, failure)).not.toEqual([]);
    expect(validateAgainst(output, success)).not.toEqual([]);
    expect(validateAgainst(output, { error })).not.toEqual([]);
    expect(schemaList(output.oneOf)).toHaveLength(2);
  });

  it('execute failure revision is optional but must be a string when present', () => {
    const output = outputOf(byName(mcp(), 'blok_execute'));

    expect(validateAgainst(output, { ok: false, error, warnings: [], delivery })).toEqual([]);
    expect(validateAgainst(output, { ok: false, revision: 'rev-2', error, warnings: [], delivery })).toEqual([]);
    expect(validateAgainst(output, { ok: false, revision: null, error, warnings: [], delivery })).not.toEqual([]);
  });

  it('rejects malformed delivery and changed sets', () => {
    const output = outputOf(byName(mcp(), 'blok_execute'));
    const result = {
      ok: true,
      revision: 'rev-2',
      results: [],
      refs: {},
      changed: { created: [], updated: [], moved: [], removed: [] },
      warnings: [],
      delivery,
    };

    expect(validateAgainst(output, { ...result, delivery: { ...delivery, serverSequence: 2 } })).not.toEqual([]);
    expect(validateAgainst(output, { ...result, changed: { created: [] } })).not.toEqual([]);
    expect(validateAgainst(output, { ...result, warnings: [{ code: 'SANITIZED' }] })).not.toEqual([]);
  });

  it('adds a required MCP-only handle to every input without duplicate requirements', () => {
    mcp(true).forEach(tool => {
      const input = inputOf(tool);

      expect(propertiesOf(input).handle).toEqual({ type: 'string', 'x-mcp-header': 'Blok-Handle' });
      expect(input.required).toContain('handle');
      expect(Array.isArray(input.required) ? input.required.filter(item => item === 'handle') : []).toHaveLength(1);
    });
  });

  it('never adds handle outside an opted-in MCP renderer', () => {
    [
      ...mcp(false),
      ...renderAgentTools(makeContract(), { format: 'anthropic', handle: true }),
      ...renderAgentTools(makeContract(), { format: 'openai', handle: true }),
    ].forEach(tool => expect(propertiesOf(inputOf(tool))).not.toHaveProperty('handle'));
  });

  it('counts MCP handle overhead against full-mode limits', () => {
    const properties = Object.fromEntries(Array.from({ length: 4995 }, (_, index) => [`p${index}`, { type: 'string' }]));
    const contract = makeContract([command('wide.run', { type: 'object', properties })]);

    expect(() => renderAgentTools(contract, { format: 'mcp', schema: 'full', handle: true }))
      .toThrowError(expect.objectContaining({ name: 'AgentToolsTooLargeError', limit: 'properties', actual: 5001 }));
  });

  it('MCP outputs are fresh and cannot contaminate later renders', () => {
    const output = outputOf(byName(mcp(), 'blok_execute'));
    const failure = schemaList(output.oneOf)[1];

    if (failure === undefined) {
      throw new Error('Missing execute failure');
    }

    schema(propertiesOf(failure).delivery).type = 'string';

    expect(outputOf(byName(mcp(), 'blok_execute'))).not.toEqual(output);
  });

  it('rejects a cyclic read-result schema instead of returning cyclic MCP JSON', () => {
    const result: Schema = { type: 'object' };

    result.allOf = [result];

    expect(() => renderAgentTools(makeContract([command('doc.read', { type: 'object' }, { result })]), { format: 'mcp' }))
      .toThrowError(TypeError);
  });
});

describe('renderAgentTools complete definition key collision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps each command linked to its own definition when complete hoisted keys collide', () => {
    const args = (definition: string, value: string): Schema => ({
      type: 'object',
      properties: { value: { $ref: `#/$defs/${definition}` } },
      $defs: { [definition]: { type: 'string', const: value } },
    });
    const contract = deepFreeze(makeContract([
      command('a.b', args('x__y', 'first')),
      command('a.b__x', args('y', 'second')),
    ]));
    const before = JSON.stringify(contract);
    const tools = renderAgentTools(contract, { format: 'anthropic', schema: 'full' });
    const execute = byName(tools, 'blok_execute');
    const defs = schema(inputOf(execute).$defs);
    const refs = schemaList(executeItems(execute).oneOf).map(branch => {
      const value = schema(propertiesOf(schema(propertiesOf(branch).args)).value);
      const reference = value.$ref;

      if (typeof reference !== 'string') {
        throw new Error('Missing command definition reference');
      }

      return reference;
    });

    expect(refs.map(reference => schema(defs[reference.slice('#/$defs/'.length)]).const))
      .toEqual(['first', 'second']);
    expect(refs[0]).toBe('#/$defs/a_b__x__y');
    expect(new Set(refs).size).toBe(2);
    expect(JSON.stringify(contract)).toBe(before);
  });
});
describe('renderAgentTools own definition keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serializes an own hoisted definition when its key is __proto__', () => {
    const args: Schema = {
      type: 'object',
      properties: { value: { $ref: '#/$defs/' } },
      $defs: Object.fromEntries([['', { type: 'string', const: 'own-definition' }]]),
    };
    const contract = deepFreeze(makeContract([
      command('_.proto', args, { source: { tool: '_', target: 'block' } }),
    ]));
    const before = JSON.stringify(contract);
    const tools = renderAgentTools(contract, { format: 'anthropic', schema: 'full' });
    const execute = byName(tools, 'blok_execute');
    const serialized: unknown = JSON.parse(JSON.stringify(inputOf(execute)));
    const root = schema(serialized);
    const defs = isSchema(root.$defs) ? root.$defs : {};

    expect(Object.prototype.hasOwnProperty.call(defs, '__proto__')).toBe(true);

    const branches = schemaList(schema(schema(propertiesOf(root).commands).items).oneOf);
    const branch = branches[0];

    if (branch === undefined) {
      throw new Error('Missing command branch');
    }

    const value = schema(propertiesOf(schema(propertiesOf(branch).args)).value);

    const reference = value.$ref;

    expect(reference).toBe('#/$defs/__proto__');

    if (typeof reference !== 'string') {
      throw new Error('Missing command definition reference');
    }

    expect(schema(defs[reference.slice('#/$defs/'.length)])).toEqual({ type: 'string', const: 'own-definition' });
    expect(JSON.stringify(contract)).toBe(before);
  });
});
