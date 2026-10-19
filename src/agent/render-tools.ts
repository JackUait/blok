import type { AgentContract, CommandEntry } from '../../types/tool-manifest';

import { carriesRef } from '../shared/agent/names';
import { EXECUTE_OUTPUT_SCHEMA, orError } from './result-schemas';
import { cloneSchema, hoistDefs, isClosedSchema, measureSchema, shareRepeatedSchemas } from './schema-walk';

export type AgentToolName = 'blok_read' | 'blok_describe' | 'blok_execute';

export interface RenderOptions {
  format: 'anthropic' | 'openai' | 'mcp';
  /** 'mixed': full arguments for COMMON_COMMANDS, the envelope for the rest. */
  schema?: 'envelope' | 'full' | 'mixed';
  strict?: boolean;
  handle?: boolean;
}

export type RenderedTool =
  | { name: AgentToolName; description: string; input_schema: Record<string, unknown>; strict?: boolean }
  | { type: 'function'; name: AgentToolName; description: string; parameters: Record<string, unknown>; strict?: boolean }
  | { name: AgentToolName; description: string; inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown> };

type Schema = Record<string, unknown>;

export class AgentToolsStrictError extends Error {
  public readonly tool: AgentToolName;
  public readonly reason: string;

  public constructor(tool: AgentToolName, reason: string) {
    super(`Cannot render ${tool} with strict: true: ${reason}`);
    this.name = 'AgentToolsStrictError';
    this.tool = tool;
    this.reason = reason;
  }
}

export const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export const OPENAI_SCHEMA_LIMITS: { readonly properties: 5000; readonly depth: 10; readonly enumValues: 1000 } = {
  properties: 5000,
  depth: 10,
  enumValues: 1000,
};

export class AgentToolsTooLargeError extends Error {
  public readonly limit: keyof typeof OPENAI_SCHEMA_LIMITS;
  public readonly actual: number;

  public constructor(limit: keyof typeof OPENAI_SCHEMA_LIMITS, actual: number) {
    super(`The 'full' schema has ${actual} ${limit}; the limit is ${OPENAI_SCHEMA_LIMITS[limit]}. Use schema: 'envelope'.`);
    this.name = 'AgentToolsTooLargeError';
    this.limit = limit;
    this.actual = actual;
  }
}

/**
 * The commands most edits use. 'full' for all of them is too big to send on every call.
 * text.format, block.convert, doc.setTitle and doc.setIcon are the ones models looked up most
 * with blok_describe in the MCP eval.
 */
export const COMMON_COMMANDS: readonly string[] = [
  'block.insert', 'text.replace', 'block.delete', 'markdown.insert', 'block.move',
  'text.format', 'block.convert', 'doc.setTitle', 'doc.setIcon',
];

// Repeats shorter than this cost about as much as the $ref that replaces them.
const SHARED_SCHEMA_MIN_LENGTH = 100;

const RESULT_SHOWS_BLOCKS = 'Its result lists the changed blocks with their data as they now read, so you can check your work without blok_read.';


const SEVERAL_BLOCKS = 'To add several text blocks at once (headings, paragraphs, lists, code), use one markdown.insert.';

const DESCRIPTIONS: Record<AgentToolName, string> = {
  blok_read: 'Read the document as a tree of blocks with ids, types and text. Read before you edit, and again after a STALE error.',
  blok_describe: 'Look up what you can do. With no arguments it lists tools and commands. Pass { tool } or { command } to get the argument schema.',
  blok_execute: `Run a batch of commands. Either all of them land or none do. Use block ids from blok_read. ${SEVERAL_BLOCKS} Call blok_describe for a command's arguments. ${RESULT_SHOWS_BLOCKS}`,
};

const readInput = (contract: AgentContract): Schema => {
  const entry = contract.commands.find(candidate => candidate.name === 'doc.read');

  return entry === undefined
    ? { type: 'object', properties: {}, additionalProperties: false }
    : { ...cloneSchema(entry.args), type: 'object' };
};

const describeInput = (): Schema => ({
  type: 'object',
  properties: { tool: { type: 'string' }, command: { type: 'string' } },
  additionalProperties: false,
});

const envelopeItem = (names: string[]): Schema => ({
  type: 'object',
  properties: {
    name: { type: 'string', enum: names },
    args: { type: 'object' },
    ref: { type: 'string' },
  },
  required: ['name', 'args'],
});

const executeInput = (items: Schema): Schema => ({
  type: 'object',
  properties: {
    commands: { type: 'array', minItems: 1, items },
    expectRevision: { type: 'string' },
  },
  required: ['commands'],
});

const fullBranches = (commands: CommandEntry[], defs: Schema): Schema[] => {
  const safePrefix = (name: string): string => name.replace(/[^A-Za-z0-9_]/g, '_');
  const reserved = new Set(commands.map(entry => safePrefix(entry.name)));
  const used = new Set<string>();

  return commands.map(entry => {
    const base = safePrefix(entry.name);
    const candidate = { prefix: base, suffix: 2 };

    while (used.has(candidate.prefix) || (candidate.prefix !== base && reserved.has(candidate.prefix))) {
      candidate.prefix = `${base}__${candidate.suffix++}`;
    }

    used.add(candidate.prefix);

    return {
      type: 'object',
      properties: {
        name: { const: entry.name },
        args: hoistDefs(candidate.prefix, entry.args, defs),
        ...(carriesRef(entry) && { ref: { type: 'string' } }),
      },
      required: ['name', 'args'],
      additionalProperties: false,
    };
  });
};

const withDefs = (root: Schema, defs: Schema): Schema => (Object.keys(defs).length === 0 ? root : { ...root, $defs: defs });

const fullExecuteInput = (contract: AgentContract): Schema => {
  const defs: Schema = {};
  const branches = fullBranches(contract.commands.filter(entry => entry.available), defs);

  return withDefs(executeInput({ oneOf: branches }), defs);
};

const isCommon = (entry: CommandEntry): boolean => COMMON_COMMANDS.includes(entry.name);

// The envelope branch never lists a common command, so one item matches exactly one branch.
const mixedExecuteInput = (contract: AgentContract): Schema => {
  const available = contract.commands.filter(entry => entry.available);
  const rest = available.filter(entry => !isCommon(entry)).map(entry => entry.name);
  const defs: Schema = {};
  const branches = [...fullBranches(available.filter(isCommon), defs), ...(rest.length === 0 ? [] : [envelopeItem(rest)])];
  const input = executeInput({ oneOf: branches });

  shareRepeatedSchemas(input, defs, SHARED_SCHEMA_MIN_LENGTH);

  return withDefs(input, defs);
};

const mixedExecuteDescription = (contract: AgentContract): string => {
  const common = contract.commands.filter(entry => entry.available && isCommon(entry)).map(entry => entry.name);

  return `Run a batch of commands. Either all of them land or none do. Use block ids from blok_read. ${SEVERAL_BLOCKS} The schema has the full arguments for ${common.join(', ')}. Call blok_describe for any other command's arguments. ${RESULT_SHOWS_BLOCKS}`;
};

const assertWithinLimits = (input: Schema): void => {
  const size = measureSchema(input);
  const limits: Array<keyof typeof OPENAI_SCHEMA_LIMITS> = ['properties', 'depth', 'enumValues'];

  limits.forEach(limit => {
    if (size[limit] > OPENAI_SCHEMA_LIMITS[limit]) {
      throw new AgentToolsTooLargeError(limit, size[limit]);
    }
  });
};

const strictFor = (options: RenderOptions, name: AgentToolName, input: Schema): boolean => {
  if (options.strict !== true || name === 'blok_execute' || options.format === 'mcp') {
    return false;
  }

  if (!isClosedSchema(input)) {
    throw new AgentToolsStrictError(name, 'an object schema is not closed');
  }

  if (options.format === 'openai' && !isClosedSchema(input, true)) {
    throw new AgentToolsStrictError(name, 'every properties key must be required');
  }

  return true;
};

const isSchema = (value: unknown): value is Schema =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const withHandle = (options: RenderOptions, input: Schema): Schema => {
  if (options.format !== 'mcp' || options.handle !== true) {
    return input;
  }

  const properties = isSchema(input.properties) ? input.properties : {};
  const required: unknown[] = Array.isArray(input.required) ? input.required : [];

  return {
    ...input,
    properties: { ...properties, handle: { type: 'string', 'x-mcp-header': 'Blok-Handle' } },
    required: required.includes('handle') ? [...required] : [...required, 'handle'],
  };
};

const outputFor = (contract: AgentContract, name: AgentToolName): Schema => {
  if (name === 'blok_execute') {
    return cloneSchema(EXECUTE_OUTPUT_SCHEMA);
  }

  const read = contract.commands.find(entry => entry.name === 'doc.read');
  const success = name === 'blok_read' && read?.result !== undefined ? cloneSchema(read.result) : { type: 'object' };

  return cloneSchema(orError(success));
};

const wrap = (contract: AgentContract, options: RenderOptions, name: AgentToolName, rawInput: Schema): RenderedTool => {
  const description = name === 'blok_execute' && options.schema === 'mixed' ? mixedExecuteDescription(contract) : DESCRIPTIONS[name];
  const input = withHandle(options, rawInput);
  const strict = strictFor(options, name, input);

  if (name === 'blok_execute' && options.schema !== undefined && options.schema !== 'envelope') {
    assertWithinLimits(input);
  }

  if (options.format === 'mcp') {
    return { name, description, inputSchema: input, outputSchema: outputFor(contract, name) };
  }

  if (options.format === 'openai') {
    return { type: 'function', name, description, parameters: input, strict };
  }

  return { name, description, input_schema: input, ...(strict ? { strict: true } : {}) };
};

export function renderAgentTools(contract: AgentContract, options: RenderOptions): RenderedTool[] {
  const names = contract.commands.filter(entry => entry.available).map(entry => entry.name);
  const inputs = { full: fullExecuteInput, mixed: mixedExecuteInput, envelope: () => executeInput(envelopeItem(names)) };
  const execute = inputs[options.schema ?? 'envelope'](contract);

  return [
    wrap(contract, options, 'blok_read', readInput(contract)),
    wrap(contract, options, 'blok_describe', describeInput()),
    wrap(contract, options, 'blok_execute', execute),
  ];
}
