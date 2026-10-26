// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderAgentTools } from '../../../src/agent/render-tools';
import { orError } from '../../../src/agent/result-schemas';
import { createToolDispatcher, LIFECYCLE_ARGUMENTS } from '../../../src/mcp/dispatcher';
import { HandleRegistry } from '../../../src/mcp/handles';
import type { HandleSession } from '../../../src/mcp/session';
import { CORE_TOOL_NAMES, LIFECYCLE_TOOL_NAMES, listMcpTools, type McpTool } from '../../../src/mcp/tools';
import { createDocumentAgentSession } from '../../../src/shared/agent';
import { TOOL_ARGUMENTS } from '../../../src/shared/agent/tool-call';
import { validateAgainst } from '../../../src/shared/schema/validate';
import { createHeadlessAgentSetup } from '../../../src/view/agent-runtime';
import type { HostService } from '../../../types/tools/tool-description';

type SchemaMode = 'envelope' | 'full' | 'mixed';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const record = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error('Expected a schema object');
  }

  return value;
};

const byName = (tools: McpTool[], name: string): McpTool => {
  const tool = tools.find(candidate => candidate.name === name);

  if (tool === undefined) {
    throw new Error(`Missing tool ${name}`);
  }

  return tool;
};

const executeNames = (input: Record<string, unknown>, schema: SchemaMode): unknown => {
  const items = record(record(record(input.properties).commands).items);

  if (schema === 'envelope') {
    return record(record(items.properties).name).enum;
  }

  if (!Array.isArray(items.oneOf)) {
    throw new Error('Expected full command branches');
  }

  const branches: unknown[] = items.oneOf;
  // mixed: one branch per common command, then an envelope branch whose enum holds the rest.
  const names = branches.flatMap(branch => {
    const name = record(record(record(branch).properties).name);

    const values: unknown[] = Array.isArray(name.enum) ? name.enum : [name.const];

    return values;
  });

  return schema === 'mixed' ? [...names].sort() : names;
};

const commandFixtures: Array<{
  title: string;
  runtime: 'node' | 'node-live';
  services: HostService[];
  available: string[];
  unavailable: string[];
}> = [
  {
    title: 'stored without pageBackend',
    runtime: 'node',
    services: [],
    available: ['block.insert', 'history.undo', 'history.redo'],
    unavailable: ['page.rename', 'page.setIcon'],
  },
  {
    title: 'live without pageBackend',
    runtime: 'node-live',
    services: [],
    available: ['block.insert', 'history.undo', 'history.redo'],
    unavailable: ['page.rename', 'page.setIcon'],
  },
  {
    title: 'live with pageBackend',
    runtime: 'node-live',
    services: ['pageBackend'],
    available: ['block.insert', 'page.rename', 'page.setIcon', 'history.undo', 'history.redo'],
    unavailable: [],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MCP tools come from the shared renderer', () => {
  const { contract: stored } = createHeadlessAgentSetup({ runtime: 'node' });

  for (const schema of ['envelope', 'full', 'mixed'] as const) {
    describe(schema, () => {
      it('keeps the three core tools equal to the real renderer output', () => {
        const tools = listMcpTools(stored, { schema, handleIdleMs: 600_000 });
        const coreNames = new Set<string>(CORE_TOOL_NAMES);
        const core = tools.filter(tool => coreNames.has(tool.name));
        const rendered = renderAgentTools(stored, { format: 'mcp', handle: true, schema });

        expect(core).toEqual(rendered);
      });

      it('lists exactly six tools with lifecycle tools first', () => {
        const tools = listMcpTools(stored, { schema, handleIdleMs: 600_000 });

        expect(tools.map(tool => tool.name)).toEqual([
          'blok_list_documents', 'blok_open', 'blok_close',
          'blok_read', 'blok_describe', 'blok_execute',
        ]);
        expect(LIFECYCLE_TOOL_NAMES).toEqual(['blok_list_documents', 'blok_open', 'blok_close']);
        expect(CORE_TOOL_NAMES).toEqual(['blok_read', 'blok_describe', 'blok_execute']);
      });

      it.each(commandFixtures)('lists only available commands: $title', fixture => {
        const { contract } = createHeadlessAgentSetup({ runtime: fixture.runtime, services: fixture.services });
        const execute = byName(listMcpTools(contract, { schema, handleIdleMs: 600_000 }), 'blok_execute');
        const names = executeNames(execute.inputSchema, schema);
        const available = contract.commands.filter(entry => entry.available).map(entry => entry.name);

        expect(names).toEqual(schema === 'mixed' ? [...available].sort() : available);
        for (const name of fixture.available) {
          expect(names, name).toContain(name);
          expect(contract.commands.find(entry => entry.name === name), name).toMatchObject({ available: true });
        }
        for (const name of fixture.unavailable) {
          expect(names, name).not.toContain(name);
          expect(contract.commands.find(entry => entry.name === name), name).toMatchObject({ available: false });
        }
      });

      it('does not emit strict on any MCP tool, including blok_execute', () => {
        const tools = listMcpTools(stored, { schema, handleIdleMs: 600_000 });

        for (const tool of tools) {
          expect(tool, tool.name).not.toHaveProperty('strict');
          expect(JSON.stringify(tool), tool.name).not.toContain('"strict"');
          expect(Object.keys(tool).sort(), tool.name).toEqual(['description', 'inputSchema', 'name', 'outputSchema']);
        }
      });

      it('requires the sticky-routing handle on core tools and blok_close', () => {
        const tools = listMcpTools(stored, { schema, handleIdleMs: 600_000 });

        for (const name of [...CORE_TOOL_NAMES, 'blok_close']) {
          const input = byName(tools, name).inputSchema;
          const required: unknown[] = Array.isArray(input.required) ? input.required : [];

          expect(record(input.properties).handle, name).toEqual({ type: 'string', 'x-mcp-header': 'Blok-Handle' });
          expect(required.filter(key => key === 'handle'), name).toEqual(['handle']);
        }
      });
    });
  }

  it('keeps lifecycle tools independent of the execute schema mode', () => {
    const envelope = listMcpTools(stored, { schema: 'envelope', handleIdleMs: 600_000 });
    const full = listMcpTools(stored, { schema: 'full', handleIdleMs: 600_000 });

    expect(full.slice(0, 3)).toEqual(envelope.slice(0, 3));
  });

  it('lets blok_open read in the same call: view takes blok_read arguments and the description says so', () => {
    const tools = listMcpTools(stored, { schema: 'mixed', handleIdleMs: 600_000 });
    const open = byName(tools, 'blok_open');
    const read = byName(tools, 'blok_read').inputSchema;
    const { handle: _handle, ...readProperties } = record(read.properties);

    expect(record(open.inputSchema.properties).view).toEqual({
      ...read,
      properties: readProperties,
      required: (Array.isArray(read.required) ? read.required : []).filter(key => key !== 'handle'),
    });
    expect(open.description).toMatch(/view.*blok_read/);
  });

  it('tells the model to open with write: true before it edits, so its first blok_execute is not READ_ONLY', () => {
    const open = byName(listMcpTools(stored, { schema: 'mixed', handleIdleMs: 600_000 }), 'blok_open');

    expect(open.description).toMatch(/write: true/);
  });

  it('says query matches ids and titles, not content, so the model does not search for words in the text', () => {
    const list = byName(listMcpTools(stored, { schema: 'mixed', handleIdleMs: 600_000 }), 'blok_list_documents');

    expect(list.description).toMatch(/query matches .*ids? and titles?.*not .*content/i);
  });

  it('declares optional list filters with bounded query and limit', () => {
    const input = byName(listMcpTools(stored, { schema: 'envelope', handleIdleMs: 600_000 }), 'blok_list_documents').inputSchema;

    expect(input).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', maxLength: 200, description: 'Matches part of a document id or title. It does not search the text inside documents.' },
        cursor: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      },
    });
    expect(validateAgainst(input, {})).toEqual([]);
    expect(validateAgainst(input, { query: 'q'.repeat(200), cursor: 'next', limit: 100 })).toEqual([]);
    expect(validateAgainst(input, { limit: 1 })).toEqual([]);
    for (const invalid of [{ query: 'q'.repeat(201) }, { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { extra: true }]) {
      expect(validateAgainst(input, invalid)).not.toEqual([]);
    }
  });

  it('opens by document id or by a search, with auto mode, read-only default and an optional first view', () => {
    const input = byName(listMcpTools(stored, { schema: 'envelope', handleIdleMs: 600_000 }), 'blok_open').inputSchema;

    expect(input).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {
        documentId: { type: 'string', minLength: 1, maxLength: 512 },
        query: expect.objectContaining({ type: 'string', maxLength: 200 }),
        mode: { enum: ['auto', 'live', 'stored'], default: 'auto' },
        write: { type: 'boolean', default: false },
        view: expect.objectContaining({ type: 'object' }),
      },
    });
    expect(validateAgainst(input, { documentId: 'd'.repeat(512) })).toEqual([]);
    for (const mode of ['auto', 'live', 'stored']) {
      expect(validateAgainst(input, { documentId: 'doc', mode, write: true, view: {} })).toEqual([]);
    }
    expect(validateAgainst(input, {})).toEqual([]);
    expect(validateAgainst(input, { query: 'plan', write: true })).toEqual([]);
    for (const invalid of [{ documentId: '' }, { documentId: 'd'.repeat(513) }, { query: 'q'.repeat(201) }, { documentId: 'doc', mode: 'other' }, { documentId: 'doc', extra: true }]) {
      expect(validateAgainst(input, invalid)).not.toEqual([]);
    }
  });

  it('closes only a required handle', () => {
    const input = byName(listMcpTools(stored, { schema: 'envelope', handleIdleMs: 600_000 }), 'blok_close').inputSchema;

    expect(input).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['handle'],
      properties: { handle: { type: 'string', 'x-mcp-header': 'Blok-Handle' } },
    });
    expect(validateAgainst(input, { handle: 'handle-1' })).toEqual([]);
    for (const invalid of [{}, { handle: 1 }, { handle: 'handle-1', extra: true }]) {
      expect(validateAgainst(input, invalid)).not.toEqual([]);
    }
  });

  it('describes document listings and rejects rows without ids', () => {
    const output = byName(listMcpTools(stored, { schema: 'envelope', handleIdleMs: 600_000 }), 'blok_list_documents').outputSchema;

    expect(validateAgainst(output, { documents: [{ title: 'Missing id' }] })).not.toEqual([]);
    expect(validateAgainst(output, { documents: [] })).toEqual([]);
    expect(validateAgainst(output, {
      documents: [{ id: 'doc-1', title: null, live: true }, { id: 'doc-2', title: 'Two', live: false }],
      nextCursor: null,
      supported: false,
    })).toEqual([]);
    expect(validateAgainst(output, { documents: [], nextCursor: 'next', supported: true })).toEqual([]);
    for (const invalid of [{}, { documents: 'docs' }, { documents: [], supported: 'false' }, { documents: [], nextCursor: 1 }]) {
      expect(validateAgainst(output, invalid)).not.toEqual([]);
    }
  });

  it('describes the handle, actual mode, write permission and idle expiry returned by open', () => {
    const output = byName(listMcpTools(stored, { schema: 'envelope', handleIdleMs: 600_000 }), 'blok_open').outputSchema;
    const opened = { handle: 'handle-1', mode: 'stored', write: false, expiresAfterIdleMs: 600_000 };

    expect(validateAgainst(output, { ...opened, mode: 'auto' })).not.toEqual([]);
    expect(validateAgainst(output, opened)).toEqual([]);
    for (const durability of ['acknowledged', 'best-effort', 'saved-on-execute']) {
      expect(validateAgainst(output, { ...opened, mode: 'live', write: true, durability, contractRevision: 'revision', view: {} })).toEqual([]);
    }
    for (const key of ['handle', 'mode', 'write', 'expiresAfterIdleMs'] as const) {
      const incomplete = { ...opened };

      Reflect.deleteProperty(incomplete, key);
      expect(validateAgainst(output, incomplete), key).not.toEqual([]);
    }
    for (const invalid of [{ ...opened, expiresAfterIdleMs: 1.5 }, { ...opened, durability: 'other' }, { ...opened, view: 'outline' }]) {
      expect(validateAgainst(output, invalid)).not.toEqual([]);
    }
    expect(validateAgainst(output, { ...opened, documentId: 'doc-1', title: 'One' })).toEqual([]);
    expect(validateAgainst(output, { ...opened, documentId: 'doc-1', title: null })).toEqual([]);
    expect(validateAgainst(output, { ...opened, documentId: 'doc-1', title: 7 })).not.toEqual([]);
  });

  it('lets open without a documentId answer with the documents to choose from', () => {
    const output = byName(listMcpTools(stored, { schema: 'envelope', handleIdleMs: 600_000 }), 'blok_open').outputSchema;
    const listing = { documents: [{ id: 'doc-1', title: 'One', live: false }, { id: 'doc-2', title: null, live: false }], nextCursor: null, supported: true };

    expect(validateAgainst(output, listing)).toEqual([]);
    expect(validateAgainst(output, { ...listing, queryMatched: false })).toEqual([]);
    expect(validateAgainst(output, { documents: [{ title: 'Missing id' }] })).not.toEqual([]);
  });

  it('lets the model open without listing first, and does not send it to blok_list_documents first', () => {
    const tools = listMcpTools(stored, { schema: 'mixed', handleIdleMs: 600_000 });

    expect(byName(tools, 'blok_list_documents').description).not.toMatch(/call it first/i);
    expect(byName(tools, 'blok_open').description).toMatch(/without documentId/);
    expect(byName(tools, 'blok_open').description).not.toMatch(/take the id .* from blok_list_documents/);
  });

  it('says a stored-mode close is not needed to save, and a live close leaves the room', () => {
    const close = byName(listMcpTools(stored, { schema: 'mixed', handleIdleMs: 600_000 }), 'blok_close');

    expect(close.description).toMatch(/stored mode.*blok_execute.*saves/i);
    expect(close.description).toMatch(/live.*leaves the room/i);
  });

  it('describes close acknowledgement and optional host-record lag', () => {
    const output = byName(listMcpTools(stored, { schema: 'envelope', handleIdleMs: 600_000 }), 'blok_close').outputSchema;

    expect(validateAgainst(output, { closed: true })).not.toEqual([]);
    expect(validateAgainst(output, { closed: true, unsavedBatches: 0 })).toEqual([]);
    expect(validateAgainst(output, { closed: false, unsavedBatches: 2, hostRecordLags: true })).toEqual([]);
    for (const invalid of [{ unsavedBatches: 0 }, { closed: 'true', unsavedBatches: 0 }, { closed: true, unsavedBatches: 1.5 }, { closed: true, unsavedBatches: 0, hostRecordLags: 'true' }]) {
      expect(validateAgainst(output, invalid)).not.toEqual([]);
    }
  });

  it.each(LIFECYCLE_TOOL_NAMES)('%s returns a bare AgentError branch', name => {
    const output = byName(listMcpTools(stored, { schema: 'envelope', handleIdleMs: 600_000 }), name).outputSchema;

    expect(validateAgainst(output, { error: { code: 'UNKNOWN_HANDLE', message: 'Unknown handle', retryable: false } })).toEqual([]);
    expect(validateAgainst(output, { error: { code: 'UNKNOWN_HANDLE', message: 'Unknown handle' } })).not.toEqual([]);
  });

  it.each([
    { handleIdleMs: 600_000, duration: '10 minutes' },
    { handleIdleMs: 120_000, duration: '2 minutes' },
    { handleIdleMs: 45_000, duration: '45 seconds' },
  ])('states $duration of idle expiry in blok_open', ({ handleIdleMs, duration }) => {
    const open = byName(listMcpTools(stored, { schema: 'envelope', handleIdleMs }), 'blok_open');

    expect(open.description).toContain(duration);
    expect(open.description).toContain('without a call');
    expect(open.description).toContain('open again');
    expect(open.description).toContain('Never put Markdown or HTML into block data');
    expect(open.description).toContain('text.format');
    expect(open.description).toContain('markdown.insert');
  });

  it('does not hand-write core tool names in src/mcp/tools.ts', () => {
    const path = resolve(__dirname, '../../../src/mcp/tools.ts');
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const coreNames = new Set<string>(CORE_TOOL_NAMES);
    const violations: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node)
        && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
        && node.name.text === 'name'
        && (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))
        && coreNames.has(node.initializer.text)) {
        violations.push(node.getText(source));
      }

      ts.forEachChild(node, visit);
    };

    visit(source);
    expect(violations).toEqual([]);
  });
});

describe('MCP lifecycle outputs use the renderer error branch', () => {
  const { contract } = createHeadlessAgentSetup({ runtime: 'node' });
  const cases = [
    { name: 'blok_list_documents', success: { documents: [] } },
    { name: 'blok_open', success: { handle: 'handle-1', mode: 'stored', write: false, expiresAfterIdleMs: 600_000 } },
    { name: 'blok_close', success: { closed: true, unsavedBatches: 0 } },
  ];

  for (const schema of ['envelope', 'full'] as const) {
    it.each(cases)(`${schema}: $name keeps canonical, disjoint success and error branches`, ({ name, success }) => {
      const output = byName(listMcpTools(contract, { schema, handleIdleMs: 600_000 }), name).outputSchema;
      const branches: unknown[] = Array.isArray(output.oneOf) ? output.oneOf : [];
      const successBranch = record(branches[0]);
      const successParts: unknown[] = Array.isArray(successBranch.allOf) ? successBranch.allOf : [];
      const successSchema = successParts.length === 0 ? successBranch : record(successParts[0]);

      expect(output).toEqual(orError(successSchema));

      const bareError = record(branches[1]);
      const forbidden = record(record(successParts[1]).not);
      const failure = {
        error: {
          code: 'UNKNOWN_HANDLE', message: 'Unknown handle', retryable: false,
          commandIndex: 2, path: 'commands/2', details: { handle: 'handle-1' },
        },
      };
      const mixed = { ...success, ...failure };

      // validateAgainst has no not evaluator; check its forbidden predicate directly.
      expect(validateAgainst(forbidden, mixed)).toEqual([]);
      expect(validateAgainst(bareError, mixed)).not.toEqual([]);
      expect(validateAgainst(forbidden, success)).not.toEqual([]);
      expect(validateAgainst(successSchema, success)).toEqual([]);
      expect(bareError.additionalProperties).toBe(false);
      expect(validateAgainst(bareError, failure)).toEqual([]);
      expect(validateAgainst(bareError, { ...failure, extra: true })).not.toEqual([]);
      expect(validateAgainst(bareError, { error: { ...failure.error, commandIndex: '2' } })).not.toEqual([]);
      expect(validateAgainst(bareError, { error: { ...failure.error, path: 2 } })).not.toEqual([]);
      expect(validateAgainst(bareError, { error: { ...failure.error, details: 'details' } })).not.toEqual([]);
    });
  }
});

describe('MCP error outputs match each tool\'s outputSchema', () => {
  const setup = createHeadlessAgentSetup({ runtime: 'node' });
  const caller = { principal: 'alice', clientName: 'test', scopes: null };
  const registries: HandleRegistry<HandleSession>[] = [];
  const agents: Array<ReturnType<typeof createDocumentAgentSession>> = [];

  afterEach(async () => {
    await Promise.all(registries.splice(0).map(registry => registry.closeAll(async () => undefined)));
    agents.splice(0).forEach(agent => agent.close());
  });

  const openDispatcher = async (): Promise<{ call: (name: string, args: Record<string, unknown>) => ReturnType<ReturnType<typeof createToolDispatcher>> }> => {
    const agent = createDocumentAgentSession({
      document: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: [{ text: 'Hello' }] } }] },
      tools: setup.tools,
      contract: setup.contract,
      ports: setup.ports,
      actor: { id: 'agent', name: 'Agent', kind: 'agent' },
    });

    agents.push(agent);
    const session: HandleSession = {
      mode: 'stored',
      write: true,
      durability: 'saved-on-execute',
      contractRevision: setup.contract.revision,
      read: args => agent.read(args),
      describe: query => agent.describe(query),
      execute: async batch => ({ ...await agent.execute(batch), delivery: { durable: false, pending: false, serverSequence: null, savedVersion: null } }),
      close: async () => ({ unsavedBatches: 0, hostRecordLags: false }),
    };
    const handles = new HandleRegistry<HandleSession>({ idleMs: 600_000, maxPerPrincipal: 8, onExpire: async () => undefined });

    registries.push(handles);
    const dispatch = createToolDispatcher({
      handles,
      open: async () => session,
      list: async () => ({ documents: [], nextCursor: null, supported: true }),
      stillAllowed: async () => true,
      handleIdleMs: 600_000,
    });
    const opened = await dispatch('blok_open', { documentId: 'doc', write: true }, caller);
    const handle = String(opened.structuredContent.handle);

    return { call: (name, args) => dispatch(name, { ...args, ...(name === 'blok_list_documents' || name === 'blok_open' ? {} : { handle }) }, caller) };
  };

  // validateAgainst has no not evaluator, so an orError output is checked against its error branch.
  const errorSchemaOf = (tool: McpTool): Record<string, unknown> => {
    const branches: unknown[] = Array.isArray(tool.outputSchema.oneOf) ? tool.outputSchema.oneOf : [];
    const bare = branches.map(record).find(branch => branch.additionalProperties === false
      && Array.isArray(branch.required) && branch.required.includes('error'));

    return bare ?? tool.outputSchema;
  };

  for (const schema of ['envelope', 'full', 'mixed'] as const) {
    it(`${schema}: every tool's accepted arguments are its inputSchema properties`, () => {
      for (const tool of listMcpTools(setup.contract, { schema, handleIdleMs: 600_000 })) {
        const properties = Object.keys(record(tool.inputSchema.properties)).sort();
        // doc.read's own schema checks the view arguments.
        const readArguments = Object.keys(record(record(setup.contract.commands.find(entry => entry.name === 'doc.read')?.args).properties));
        const core: Record<string, readonly string[]> = {
          blok_read: ['handle', ...readArguments],
          blok_describe: ['handle', ...TOOL_ARGUMENTS.blok_describe],
          blok_execute: ['handle', ...TOOL_ARGUMENTS.blok_execute],
        };
        const accepted = core[tool.name] ?? LIFECYCLE_ARGUMENTS[tool.name];

        expect(properties, tool.name).toEqual([...accepted].sort());
      }
    });
  }

  it.each(listMcpTools(setup.contract, { schema: 'envelope', handleIdleMs: 600_000 }).map(tool => [tool.name, tool] as const))(
    '%s refuses an unknown argument with INVALID_ARGS, in its declared error shape',
    async (name, tool) => {
      const { call } = await openDispatcher();
      const outcome = await call(name, { notAnArgument: 1 });

      // blok_read's arguments go to doc.read, whose path is /commands/0/args/notAnArgument.
      expect(outcome.structuredContent).toMatchObject({ error: { code: 'INVALID_ARGS', path: expect.stringMatching(/\/notAnArgument$/) } });
      expect(outcome.isError).toBe(true);
      expect(validateAgainst(errorSchemaOf(tool), outcome.structuredContent)).toEqual([]);
    },
  );

  it.each([
    ['blok_read', { page: 'p1' }],
    ['blok_read', { invalidJson: '{' }],
    ['blok_describe', { tool: 123 }],
    ['blok_describe', { tool: 'nope' }],
    ['blok_execute', { page: 'p1', commands: [] }],
    ['blok_execute', { invalidJson: '{' }],
    ['blok_execute', { commands: [] }],
    ['blok_execute', { commands: [null] }],
    ['blok_execute', { commands: [{ name: 'block.delete', args: { id: 'zzz' } }] }],
  ])('%s answers %o with an error its outputSchema accepts', async (name, args) => {
    const tool = byName(listMcpTools(setup.contract, { schema: 'envelope', handleIdleMs: 600_000 }), name);
    const { call } = await openDispatcher();
    const outcome = await call(name, args);

    expect(outcome.isError).toBe(true);
    expect(validateAgainst(errorSchemaOf(tool), outcome.structuredContent)).toEqual([]);
  });
});
