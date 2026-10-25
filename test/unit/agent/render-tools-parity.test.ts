// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderAgentTools } from '../../../src/agent/render-tools';
import type { RenderedTool } from '../../../src/agent/render-tools';
import { readCustomToolsFile } from '../../../src/shared/custom-tools-file';
import { validateAgainst } from '../../../src/shared/schema/validate';
import { inlineRefs } from './fixtures/inline-refs';
import type { AgentContract } from '../../../types/tool-manifest';
import { contractFor } from './harness';
import { CORPUS_ROOT } from './parity/corpus';

interface Schema {
  properties?: Record<string, Schema>;
  items?: Schema;
  oneOf?: Schema[];
  enum?: string[];
  const?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Reads only the schema keys this test walks; anything else is dropped. */
const asSchema = (value: unknown): Schema => {
  if (!isRecord(value)) {
    return {};
  }

  const { properties, items, oneOf } = value;

  return {
    ...(isRecord(properties) && {
      properties: Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, asSchema(v)])),
    }),
    ...(items !== undefined && { items: asSchema(items) }),
    ...(Array.isArray(oneOf) && { oneOf: oneOf.map(asSchema) }),
    ...(Array.isArray(value.enum) && { enum: value.enum.filter((x): x is string => typeof x === 'string') }),
    ...(typeof value.const === 'string' && { const: value.const }),
  };
};

const rating = readCustomToolsFile(JSON.parse(readFileSync(join(CORPUS_ROOT, 'custom-tools/rating.json'), 'utf8')));
const editor = contractFor('editor', rating);
const node = contractFor('node', rating);

const rawSchemaOf = (tool: RenderedTool): Record<string, unknown> => {
  if ('input_schema' in tool) {
    return tool.input_schema;
  }

  return 'inputSchema' in tool ? tool.inputSchema : tool.parameters;
};

const schemaOf = (tool: RenderedTool): Schema => asSchema(rawSchemaOf(tool));

const executeTool = (tools: RenderedTool[]): RenderedTool => {
  const tool = tools.find((t) => t.name === 'blok_execute');

  if (tool === undefined) {
    throw new Error('blok_execute was not rendered');
  }

  return tool;
};

const branchNames = (branch: Schema): string[] => {
  const name = branch.properties?.name;

  return name?.const === undefined ? [...(name?.enum ?? [])] : [name.const];
};

/** Command names a blok_execute schema accepts: envelope (enum), full (oneOf + const) or mixed (both). */
const executeNames = (tool: RenderedTool): string[] => {
  const item = schemaOf(tool).properties?.commands?.items ?? {};

  return (item.oneOf ?? [item]).flatMap(branchNames).sort();
};

/** Commands both contracts list but with a different `available` (06 R3-1). */
const differing = (a: AgentContract, b: AgentContract): Set<string> =>
  new Set(a.commands.filter((x) => b.commands.find((y) => y.name === x.name)?.available !== x.available).map((x) => x.name));

/** Block types one contract can insert and the other cannot (a page needs the editor's prepareInsert). */
const insertableIn = (a: AgentContract, b: AgentContract): Set<string> =>
  new Set(a.manifest.blocks.filter((x) => b.manifest.blocks.find((y) => y.name === x.name)?.insertable !== x.insertable).map((x) => x.name));

const BLOCK_LIST = /^A block tool: ([^.]*)\./;

/** block.insert's type description lists insertable types; drop the ones only one side lists. */
const withoutTypes = (value: unknown, types: Set<string>): unknown => {
  if (typeof value === 'string') {
    return value.replace(BLOCK_LIST, (_all, list: string) =>
      `A block tool: ${list.split(', ').filter((name) => !types.has(name)).join(', ')}.`);
  }
  if (Array.isArray(value)) {
    return value.map((item) => withoutTypes(item, types));
  }

  return isRecord(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withoutTypes(item, types)])) : value;
};

const withoutDeclaredDifferences = (tool: RenderedTool, skip: Set<string>): Record<string, unknown> => {
  const scrubbed = withoutTypes(structuredClone(rawSchemaOf(tool)), insertableIn(editor, node));
  const copy = isRecord(scrubbed) ? scrubbed : {};
  const properties = isRecord(copy.properties) ? copy.properties : {};

  // The MCP surface adds the session `handle` (04); it is the one declared extra.
  delete properties.handle;

  if (Array.isArray(copy.required)) {
    copy.required = copy.required.filter((key) => key !== 'handle');
  }

  // `required: []` and no `required` mean the same.
  if (Array.isArray(copy.required) && copy.required.length === 0) {
    delete copy.required;
  }

  const commands = isRecord(properties.commands) ? properties.commands : {};
  const item = isRecord(commands.items) ? commands.items : {};
  const keep = (name: unknown): boolean => typeof name !== 'string' || !skip.has(name);

  const dropFromEnum = (branch: Record<string, unknown>): void => {
    const branchProperties = isRecord(branch.properties) ? branch.properties : {};
    const name = isRecord(branchProperties.name) ? branchProperties.name : {};

    if (Array.isArray(name.enum)) {
      name.enum = name.enum.filter(keep);
    }
  };

  if (Array.isArray(item.oneOf)) {
    const branches: unknown[] = item.oneOf.filter((branch) => keep(asSchema(branch).properties?.name?.const));

    branches.filter(isRecord).forEach(dropFromEnum);
    item.oneOf = branches;
  }

  dropFromEnum(item);

  return copy;
};

const available = (c: AgentContract): string[] => c.commands.filter((x) => x.available).map((x) => x.name).sort();

describe.each(['envelope', 'full', 'mixed'] as const)('renderAgentTools parity (%s)', (schema) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const inApp = renderAgentTools(editor, { format: 'anthropic', schema });
  const mcp = renderAgentTools(node, { format: 'mcp', schema, handle: true });

  it('both surfaces render exactly the three core tools', () => {
    expect(inApp.map((t) => t.name).sort()).toEqual(['blok_describe', 'blok_execute', 'blok_read']);
    expect(mcp.map((t) => t.name).sort()).toEqual(['blok_describe', 'blok_execute', 'blok_read']);
  });

  it.each(['blok_read', 'blok_describe', 'blok_execute'])('%s has the same description and input schema apart from the declared differences', (name) => {
    const skip = differing(editor, node);
    const own = inApp.find((t) => t.name === name);
    const twin = mcp.find((t) => t.name === name);

    expect(own).toBeDefined();
    expect(twin).toBeDefined();
    expect(twin?.description).toBe(own?.description);
    expect(twin === undefined ? null : withoutDeclaredDifferences(twin, skip))
      .toEqual(own === undefined ? null : withoutDeclaredDifferences(own, skip));
  });

  it('blok_execute lists exactly the available commands of its own contract', () => {
    expect(executeNames(executeTool(inApp))).toEqual(available(editor));
    expect(executeNames(executeTool(mcp))).toEqual(available(node));
  });

  it('includes the custom tool action in-app only, where its handler lives', () => {
    expect(executeNames(executeTool(inApp))).toContain('rating.setValue');
    expect(executeNames(executeTool(mcp))).not.toContain('rating.setValue');
  });

  it('never marks blok_execute strict', () => {
    const tool = executeTool(inApp);

    expect('strict' in tool ? tool.strict : undefined).toBeUndefined();
  });

  it('matches the checked-in snapshot', async () => {
    await expect(JSON.stringify(inApp, null, 2)).toMatchFileSnapshot(`./__snapshots__/render-tools.anthropic.${schema}.json`);
  });
});

/** Every schema node of at least `min` chars, as JSON, once per place it appears. */
const schemaNodes = (value: unknown, min: number): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap(item => schemaNodes(item, min));
  }
  if (!isRecord(value)) {
    return [];
  }
  const json = JSON.stringify(value);
  const maps = ['properties', '$defs'].flatMap(key => (isRecord(value[key]) ? Object.values(value[key]) : []));
  const children = ['items', 'oneOf', 'anyOf', 'allOf', 'additionalProperties'].map(key => value[key]);

  return [...(json.length >= min ? [json] : []), ...[...maps, ...children].flatMap(child => schemaNodes(child, min))];
};

describe('renderAgentTools mixed schema', () => {
  const mixed = inlineRefs(rawSchemaOf(executeTool(renderAgentTools(editor, { format: 'anthropic', schema: 'mixed' }))));
  const raw = rawSchemaOf(executeTool(renderAgentTools(editor, { format: 'anthropic', schema: 'mixed' })));

  it('states each repeated argument schema once, in $defs', () => {
    const nodes = schemaNodes(raw, 100);
    const repeated = nodes.filter((node, index) => nodes.indexOf(node) !== index);

    expect(repeated).toEqual([]);
  });

  it('gives block.move its full arguments, and they still validate through $ref', () => {
    const branches = asSchema(raw).properties?.commands?.items?.oneOf ?? [];

    expect(branches.some(branch => branch.properties?.name?.const === 'block.move')).toBe(true);
    expect(validateAgainst(mixed, { commands: [{ name: 'block.move', args: { id: 'a', position: { after: 'b' } } }] })).toEqual([]);
    expect(validateAgainst(mixed, { commands: [{ name: 'block.move', args: { id: 'a', position: { after: '' } } }] })).not.toEqual([]);
    expect(validateAgainst(mixed, { commands: [{ name: 'block.move', args: { id: '', position: 'end' } }] })).not.toEqual([]);
  });
});

describe('renderAgentTools mixed rich text', () => {
  const raw = rawSchemaOf(executeTool(renderAgentTools(editor, { format: 'anthropic', schema: 'mixed' })));
  const mixed = inlineRefs(raw);
  const argsOf = (root: unknown, name: string): Record<string, unknown> => {
    const commands = isRecord(root) && isRecord(root.properties) ? root.properties.commands : undefined;
    const items = isRecord(commands) ? commands.items : undefined;
    const branches = isRecord(items) && Array.isArray(items.oneOf) ? items.oneOf : [];
    const branch = branches.find(entry => asSchema(entry).properties?.name?.const === name);
    const args = isRecord(branch) && isRecord(branch.properties) ? branch.properties.args : undefined;

    return isRecord(args) ? args : {};
  };
  const propertyOf = (args: Record<string, unknown>, key: string): unknown =>
    (isRecord(args.properties) ? args.properties[key] : undefined);

  it('text.replace with shows the segment shape: marks and the equation and page embeds', () => {
    const json = JSON.stringify(propertyOf(argsOf(mixed, 'text.replace'), 'with'));

    for (const word of ['"bold"', '"background"', '"link"', '"equation"', '"expression"', '"page"']) {
      expect(json).toContain(word);
    }
  });

  // Data differs per tool, so it points at text.replace rather than repeat the segment schema.
  it('block.insert data points rich-text fields at the text.replace segments', () => {
    const data = propertyOf(argsOf(mixed, 'block.insert'), 'data');

    expect(isRecord(data) ? data.description : undefined).toContain('text.replace "with"');
  });

  it('text.insert text shows the segment shape when described', () => {
    const textInsert = editor.commands.find(entry => entry.name === 'text.insert');
    const json = JSON.stringify(isRecord(textInsert?.args.properties) ? textInsert.args.properties.text : undefined);

    for (const word of ['"bold"', '"link"', '"equation"', '"page"']) {
      expect(json).toContain(word);
    }
  });

  it('text.format set and segment marks share one definition', () => {
    const set = propertyOf(argsOf(raw, 'text.format'), 'set');
    const ref = isRecord(set) ? set.$ref : undefined;

    expect(typeof ref).toBe('string');
    // text.format set, plus the text and embed segments of text.replace.
    expect(JSON.stringify(raw).split(`"${String(ref)}"`).length - 1).toBeGreaterThanOrEqual(3);
  });
});

describe('renderAgentTools mixed size', () => {
  it('stays a small fraction of the full schema, which is too big to send on every call', () => {
    const size = (schema: 'full' | 'mixed'): number =>
      JSON.stringify(executeTool(renderAgentTools(editor, { format: 'anthropic', schema }))).length;

    // Raised from 10_000 for the find options (matchCase, wholeWord, all) and database.updateView.
    expect(size('mixed')).toBeLessThan(10_700);
    expect(size('mixed') * 5).toBeLessThan(size('full'));
  });
});
