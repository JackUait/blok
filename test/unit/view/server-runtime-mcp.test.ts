// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inputRequired, inputResponse } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { safeClientName, defaultAgentActor } from '../../../src/mcp/actor';
import { buildMcpContracts } from '../../../src/mcp/contract';
import { checkOptionSafety, McpConfigError, parseMcpArgs } from '../../../src/mcp/config';
import { parseCustomToolsFile, parseOverridesFile } from '../../../src/mcp/custom-tools-file';
import { terminalToError } from '../../../src/mcp/live/live-session';
import { createFilesSource } from '../../../src/mcp/sources/files';
import { createToolDispatcher } from '../../../src/mcp/dispatcher';
import type { Caller, ListResult } from '../../../src/mcp/dispatcher';
import { HandleRegistry } from '../../../src/mcp/handles';
import { resolveMode } from '../../../src/mcp/mode';
import { getMcpPrompt, listMcpPrompts } from '../../../src/mcp/prompts';
import type { HandleSession } from '../../../src/mcp/session';
import { McpSurfaceError, surfaceError } from '../../../src/mcp/errors';
import { failure } from '../../../src/shared/agent/errors';
import { approvalKey } from '../../../src/shared/agent/approval';
import { modelAnswer } from '../../../src/shared/agent/model-answer';
import { approvalQuestion, canElicit, elicitationApprover, readInputResponse } from '../../../src/shared/mcp/approval';
import { createDocumentAgentSession } from '../../../src/shared/agent';
import { createHeadlessPorts, loadStoredDocument } from '../../../src/view/agent-runtime';
import type { AgentApprovalRequest, AgentBatch, AgentResult } from '../../../types/agent';
import type { OutputData } from '../../../types/data-formats/output-data';
import { assembleMcp } from '../../../src/mcp/server';
import type { BlokMcpOptions } from '../../../src/mcp/options';
import { isObject } from '../../../src/shared/type-guards';
import { invoke } from '../../../src/view/server-runtime';

import type { BlokCustomToolsFile, ManifestOverrides } from '../../../types/tool-manifest';

/*
 * Each MCP operation of the server runtime against the Node MCP's own code on the same input,
 * so C#, Go and Rust hosts that call the bundle answer what Node answers.
 */

const call = async (operation: string, input: unknown): Promise<Record<string, unknown>> => {
  const response: unknown = JSON.parse(await invoke(operation, JSON.stringify(input)));

  if (!isObject(response)) {
    throw new TypeError(`${operation} must return a JSON object.`);
  }

  return response;
};

const customTools: BlokCustomToolsFile = {
  formatVersion: 1,
  blocks: [{
    name: 'note_x',
    description: { summary: 'A note.', data: { type: 'object' } },
    statics: {
      toolbox: [],
      richTextFields: ['body'],
      acceptsChildren: false,
      ownsChildren: false,
      isLayout: false,
      deletesChildren: false,
      selfPlacesChildren: false,
      restrictedInTableCell: false,
      conversion: {},
      convertible: { import: false, export: false },
      hasPrepareInsert: false,
    },
  }],
};
const overrides: ManifestOverrides = { paragraph: { guidance: 'Keep paragraphs short.' }, quote: { hidden: true } };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('server runtime mcpSurface', () => {
  const flags = [false, true];
  const combos = flags.flatMap(pageMap => flags.flatMap(sync => flags.flatMap(source => flags.flatMap(uploads =>
    flags.map(comments => ({ pageMap, sync, source, uploads, comments }))))));

  /** The options a host would start Node with for these flags. */
  const nodeOptions = (combo: typeof combos[number], extra: Partial<BlokMcpOptions> = {}): BlokMcpOptions => ({
    transport: { kind: 'stdio' },
    auth: { kind: 'none' },
    pageTitles: combo.pageMap ? 'page-map' : 'off',
    ...(combo.sync && { sync: { url: 'ws://127.0.0.1:1/sync' }, tickets: { kind: 'secret', secret: 's'.repeat(32) } }),
    ...(combo.source && { source: { kind: 'files', dir: '/nonexistent-blok-mcp-test' } }),
    ...(combo.uploads && { uploads: { uploader: { uploadByFile: () => Promise.reject(new Error('unused')) } } }),
    ...(!combo.comments && { comments: false }),
    ...extra,
  });

  const surfaceInput = (combo: typeof combos[number], extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    pageTitles: combo.pageMap ? 'page-map' : 'off',
    sync: combo.sync,
    source: combo.source,
    uploads: combo.uploads,
    ...(!combo.comments && { comments: false }),
    ...extra,
  });

  const nodeSurface = async (options: BlokMcpOptions): Promise<Record<string, unknown>> => {
    const assembled = assembleMcp(options);

    try {
      const contracts = buildMcpContracts({
        manifest: options.manifest,
        overrides: options.overrides,
        pageTitles: options.pageTitles ?? 'off',
        createsPages: options.pageTitles === 'page-map' && (options.sync !== undefined || options.source !== undefined),
        versionHistory: options.sync !== undefined,
        uploadsFiles: options.uploads !== undefined,
        comments: options.comments !== false,
      });
      const live = new Map(contracts.live.commands.map(entry => [entry.name, entry]));

      return {
        tools: assembled.tools,
        instructions: assembled.instructions,
        prompts: listMcpPrompts(),
        contractRevision: { stored: contracts.stored.revision, live: contracts.live.revision },
        liveUnavailableCommands: contracts.stored.commands
          .filter(entry => entry.available && live.get(entry.name)?.available !== true)
          .map(entry => ({ name: entry.name, reason: live.get(entry.name)?.unavailableReason ?? 'runtime' })),
      };
    } finally {
      await assembled.stop();
    }
  };

  it.each(combos)('matches Node for %o', async (combo) => {
    expect(await call('mcpSurface', surfaceInput(combo))).toEqual(await nodeSurface(nodeOptions(combo)));
  });

  it.each(['envelope', 'full', 'mixed'] as const)('matches Node with schema %s and a custom tools file', async (schema) => {
    const combo = { pageMap: true, sync: false, source: true, uploads: false, comments: true };
    const extra = { schema, handleIdleMs: 90_500, manifest: customTools, overrides, richTextFields: { callout: ['title'] } };

    expect(await call('mcpSurface', surfaceInput(combo, extra))).toEqual(await nodeSurface(nodeOptions(combo, extra)));
  });

  it('keeps the tools JSON byte for byte, key order included', async () => {
    const combo = { pageMap: false, sync: false, source: true, uploads: false, comments: true };
    const surface = await call('mcpSurface', surfaceInput(combo));
    const node = await nodeSurface(nodeOptions(combo));

    expect(JSON.stringify(surface.tools)).toBe(JSON.stringify(node.tools));
    expect(surface.instructions).toBe(node.instructions);
  });

  it('gives stored and live their own contract revision', async () => {
    const surface = await call('mcpSurface', surfaceInput({ pageMap: false, sync: true, source: false, uploads: false, comments: true }));
    const revisions = surface.contractRevision;

    expect(isObject(revisions) && revisions.stored !== revisions.live).toBe(true);
  });
});

describe('server runtime mcpPrompt', () => {
  const cases: Array<[string, Record<string, string> | undefined]> = [
    ['improve', { selection: 'Hello "world"', blockId: 'b1', documentId: 'doc 1' }],
    ['improve', { selection: '' }],
    ['improve', undefined],
    ['proofread', {}],
    ['proofread', { selection: 'Teh cat', blockId: '' }],
    ['summarize', { blockId: 'b2', documentId: '' }],
    ['continue', { documentId: 'notes' }],
    ['nope', {}],
  ];

  it.each(cases)('matches Node for %s %o', async (name, args) => {
    const node = ((): Record<string, unknown> => {
      try {
        return { result: getMcpPrompt(name, args) };
      } catch (thrown) {
        return { error: { code: -32602, message: thrown instanceof Error ? thrown.message.replace(/^MCP error -32602: /, '') : '' } };
      }
    })();

    expect(await call('mcpPrompt', { name, ...(args !== undefined && { arguments: args }) })).toEqual(node);
  });

  it('names the refusal as Node does', async () => {
    expect(await call('mcpPrompt', { name: 'nope' })).toEqual({ error: { code: -32602, message: 'Unknown prompt: nope' } });
  });
});

const listing = (documents: Array<{ id: string; title: string | null }>, nextCursor: string | null = null): ListResult =>
  ({ documents: documents.map(doc => ({ ...doc, live: false })), nextCursor, supported: true });

/** A Node dispatcher whose IO is scripted, for the refusals and answers it builds itself. */
const nodeDispatch = (input: { lists?: ListResult[]; session?: Partial<HandleSession> } = {}) => {
  const lists = [...(input.lists ?? [])];
  const handles = new HandleRegistry<HandleSession>({ idleMs: 600_000, maxPerPrincipal: 8, onExpire: async () => undefined });
  const session: HandleSession = {
    mode: 'stored', write: true, durability: 'saved-on-execute', contractRevision: 'rev-1', exists: false,
    read: async () => ({ revision: 'r', rootId: null, blocks: [] }),
    describe: () => ({ index: { tools: [], commands: [], guidance: '' } }),
    execute: async () => ({ ok: true, revision: 'r', results: [], refs: {}, changed: { created: [], updated: [], moved: [], removed: [] }, warnings: [], delivery: { durable: false, pending: false, serverSequence: null, savedVersion: null } }),
    close: async () => ({ unsavedBatches: 0, hostRecordLags: false }),
    ...input.session,
  };
  const dispatch = createToolDispatcher({
    handles,
    open: async () => session,
    list: async () => lists.shift() ?? listing([]),
    stillAllowed: async () => true,
    handleIdleMs: 600_000,
  });

  return { dispatch, handles };
};

describe('server runtime mcpCheckCall', () => {
  const refusals: Array<[string, Record<string, unknown>, readonly string[] | null]> = [
    ['blok_open', { zzz: 1 }, null],
    ['blok_open', { write: 'yes' }, null],
    ['blok_open', { write: true }, ['blok.read']],
    ['blok_open', { documentId: '' }, null],
    ['blok_open', { documentId: 'x'.repeat(513) }, null],
    ['blok_open', { query: 7 }, null],
    ['blok_open', { documentId: 'd', mode: 'other' }, null],
    ['blok_open', { documentId: 'd', view: [] }, null],
    ['blok_open', { write: true }, ['blok.write']],
    ['blok_list_documents', { limit: '5' }, null],
    ['blok_list_documents', { cursor: 3 }, null],
    ['blok_list_documents', {}, ['blok.write']],
    ['blok_list_documents', { extra: true }, null],
    ['blok_close', {}, null],
    ['blok_close', { handle: 'h', other: 1 }, null],
    ['blok_read', { handle: 'h' }, ['blok.write']],
    ['blok_read', {}, null],
    ['blok_read', { handle: 'h', page: 'p' }, null],
    ['blok_read', { handle: 'h', page: 3 }, null],
    ['blok_describe', { handle: 'h', tool: 3 }, null],
    ['blok_describe', { handle: 'h', other: 3 }, null],
    ['blok_execute', { handle: 'h', commands: [], extra: 1 }, null],
    ['blok_execute', { handle: 'h', commands: [] }, ['blok.read']],
    ['blok_execute', { handle: '', commands: [] }, null],
    ['blok_execute', { handle: 'h', page: '' }, null],
  ];

  it.each(refusals)('refuses %s %o (scopes %o) as Node does', async (name, args, scopes) => {
    const caller: Caller = { principal: 'alice', clientName: 'test', scopes };
    const node = await nodeDispatch().dispatch(name, args, caller);

    expect(node.isError).toBe(true);
    expect(await call('mcpCheckCall', { name, arguments: args, scopes })).toEqual({ answer: node });
  });

  it('names an unknown tool', async () => {
    expect(await call('mcpCheckCall', { name: 'blok_x', arguments: {}, scopes: null })).toEqual({ unknownTool: 'Unknown tool: blok_x' });
  });

  it('says what to do next for each tool', async () => {
    const step = async (name: string, args: Record<string, unknown>, scopes: readonly string[] | null = null): Promise<unknown> =>
      (await call('mcpCheckCall', { name, arguments: args, scopes })).step;

    expect(await step('blok_list_documents', { limit: 500.7, query: 'a' })).toEqual({ tool: 'blok_list_documents', list: { limit: 100, query: 'a' } });
    expect(await step('blok_list_documents', { limit: -3, cursor: 'c' })).toEqual({ tool: 'blok_list_documents', list: { limit: 1, cursor: 'c' } });
    expect(await step('blok_open', { documentId: 'd', write: true, view: { depth: 1 } })).toEqual({ tool: 'blok_open', documentId: 'd', mode: 'auto', write: true, view: { depth: 1 } });
    expect(await step('blok_open', { query: '  Notes ', mode: 'stored' })).toEqual({ tool: 'blok_open', find: { query: 'Notes' }, mode: 'stored', write: false });
    expect(await step('blok_open', { query: '   ' })).toEqual({ tool: 'blok_open', find: {}, mode: 'auto', write: false });
    expect(await step('blok_close', { handle: 'h' })).toEqual({ tool: 'blok_close', handle: 'h' });
    expect(await step('blok_read', { handle: 'h', depth: 2 })).toEqual({ tool: 'blok_read', handle: 'h', write: false, call: { name: 'blok_read', view: { depth: 2 } } });
    expect(await step('blok_describe', { handle: 'h', tool: 'paragraph' })).toEqual({ tool: 'blok_describe', handle: 'h', write: false, call: { name: 'blok_describe', query: { tool: 'paragraph' } } });
    expect(await step('blok_execute', { handle: 'h', commands: [{ name: 'doc.read', args: {} }], expectRevision: 'r' }))
      .toEqual({ tool: 'blok_execute', handle: 'h', write: true, call: { name: 'blok_execute', batch: { commands: [{ name: 'doc.read', args: {} }], expectRevision: 'r' } } });
  });
});

describe('server runtime mcpListAnswer and mcpPickDocument', () => {
  const caller: Caller = { principal: 'alice', clientName: 'test', scopes: null };

  it('asks for the relisting when a query matched nothing, then marks it', async () => {
    const all = listing([{ id: 'a', title: 'A' }, { id: 'b', title: null }]);
    const node = await nodeDispatch({ lists: [listing([]), all] }).dispatch('blok_list_documents', { query: 'zz', limit: 9 }, caller);

    expect(await call('mcpListAnswer', { request: { query: 'zz', limit: 9 }, listing: listing([]) })).toEqual({ relist: { limit: 9 } });
    expect(await call('mcpListAnswer', { request: { query: 'zz', limit: 9 }, listing: listing([]), relisted: all })).toEqual({ listing: node.structuredContent });
  });

  it.each([
    [{ query: 'zz', cursor: 'c', limit: 5 }, listing([])],
    [{ limit: 5 }, listing([])],
    [{ query: 'zz', limit: 5 }, { documents: [], nextCursor: null, supported: false }],
    [{ query: 'a', limit: 5 }, listing([{ id: 'a', title: null }])],
  ])('keeps the first listing for %o', async (request, first) => {
    const node = await nodeDispatch({ lists: [first] }).dispatch('blok_list_documents', request, caller);

    expect(await call('mcpListAnswer', { request, listing: first })).toEqual({ listing: node.structuredContent });
  });

  it.each([
    [{}, listing([{ id: 'only', title: 'Only' }])],
    [{}, listing([{ id: 'a', title: null }, { id: 'b', title: null }])],
    [{ query: 'NOTES' }, listing([{ id: 'x', title: ' notes ' }, { id: 'notes-2', title: null }])],
    [{ query: 'notes' }, listing([{ id: 'Notes', title: null }], 'Notes')],
    [{ query: 'b' }, listing([{ id: 'a', title: 'B' }, { id: 'b', title: null }])],
  ])('picks a document by query %o as Node does', async (find, found) => {
    const node = await nodeDispatch({ lists: [found] }).dispatch('blok_open', 'query' in find ? { query: find.query } : {}, caller);
    const picked = await call('mcpPickDocument', { find, listing: found });

    if (typeof node.structuredContent.handle === 'string') {
      expect(picked).toEqual({ open: { documentId: node.structuredContent.documentId, title: node.structuredContent.title } });
    } else {
      expect(picked).toEqual({ answer: node });
    }
  });
});

describe('server runtime mcpOpenAnswer and mcpErrorAnswer', () => {
  const caller: Caller = { principal: 'alice', clientName: 'test', scopes: null };

  it('orders the open answer as Node does', async () => {
    const { dispatch } = nodeDispatch({
      lists: [listing([{ id: 'doc', title: 'Doc' }])],
      session: { unavailableCommands: [{ name: 'history.undo', reason: 'runtime' }] },
    });
    const node = await dispatch('blok_open', { view: {} }, caller);
    const handle = node.structuredContent.handle;

    expect(await call('mcpOpenAnswer', {
      handle,
      session: { mode: 'stored', write: true, durability: 'saved-on-execute', contractRevision: 'rev-1', exists: false, unavailableCommands: [{ name: 'history.undo', reason: 'runtime' }] },
      expiresAfterIdleMs: 600_000,
      found: { documentId: 'doc', title: 'Doc' },
      view: { revision: 'r', rootId: null, blocks: [] },
    })).toEqual({ answer: node });
    expect(JSON.stringify((await call('mcpOpenAnswer', {
      handle: 'h', session: { mode: 'live', write: false, durability: 'acknowledged', contractRevision: 'c' }, expiresAfterIdleMs: 5,
    })).answer)).toBe('{"structuredContent":{"handle":"h","mode":"live","write":false,"durability":"acknowledged","expiresAfterIdleMs":5,"contractRevision":"c"},"isError":false}');
  });

  it.each([
    ['blok_open', 'surface', 'HANDLE_LIMIT', 'You already have 8 open documents. Close one with blok_close.', undefined],
    ['blok_read', 'surface', 'UNKNOWN_HANDLE', 'No open document has this handle.', undefined],
    ['blok_execute', 'surface', 'SOURCE_UNAVAILABLE', 'The document endpoint could not be reached.', { terminal: 'x' }],
    ['blok_open', 'failure', 'CANCELLED', 'The request was cancelled before the document opened.', undefined],
    ['blok_execute', 'failure', 'APPROVAL_REQUIRED', 'One per call.', { reason: 'one-per-call' }],
  ] as const)('shapes a %s %s error as Node does', async (tool, helper, code, message, details) => {
    const thrown = helper === 'surface' ? surfaceError(code, message, details) : failure(code, message, details === undefined ? {} : { details });
    const node = await nodeDispatch({ session: { read: () => Promise.reject(thrown), execute: () => Promise.reject(thrown) } });
    const opened = await node.dispatch('blok_open', { documentId: 'd' }, caller);
    const handle = opened.structuredContent.handle;
    const outcome = tool === 'blok_open'
      ? await nodeDispatch({ session: { read: () => Promise.reject(thrown) } }).dispatch('blok_open', { documentId: 'd', view: {} }, caller)
      : await node.dispatch(tool, { handle, ...(tool === 'blok_execute' && { commands: [] }) }, caller);

    expect(await call('mcpErrorAnswer', { tool, helper, error: { code, message, ...(details !== undefined && { details }) } })).toEqual({ answer: outcome });
  });

  it('keeps a whole error as given', async () => {
    const error = { code: 'FORBIDDEN', message: 'No.', retryable: true, details: { pageId: 'p' } };

    expect(await call('mcpErrorAnswer', { tool: 'blok_read', helper: 'as-is', error })).toEqual({ answer: { structuredContent: { error }, isError: true } });
  });
});

describe('server runtime mcpResolveMode and mcpActor', () => {
  it.each([
    ['auto', false], ['auto', true], ['live', false], ['live', true], ['stored', false], ['stored', true],
  ] as const)('resolves %s with sync %s as Node does', async (requested, sync) => {
    const node = ((): Record<string, unknown> => {
      try {
        return { mode: resolveMode(requested, sync) };
      } catch (thrown) {
        return { error: thrown instanceof McpSurfaceError ? thrown.agentError : null };
      }
    })();

    expect(await call('mcpResolveMode', { requested, sync })).toEqual(node);
  });

  it.each([undefined, '', 'Claude Desktop', 'a/b\\c', '😀x', 'é'.repeat(70)])('names the actor for client %o as Node does', async (raw) => {
    const clientName = safeClientName(raw);

    expect(await call('mcpActor', { principal: 'alice', ...(raw !== undefined && { clientName: raw }) }))
      .toEqual({ clientName, actor: defaultAgentActor('alice', clientName), presenceName: clientName });
  });
});

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const docFixture: OutputData = {
  title: 'Notes <é>   😀',
  blocks: [
    { id: 'p1', type: 'paragraph', data: { text: 'Hello <b>world</b>' } },
    { id: 'p2', type: 'paragraph', data: { text: 'Second line' } },
  ],
};

describe('server runtime MCP sessions against blok-mcp over a files source', () => {
  let dir: string;
  const caller: Caller = { principal: 'alice', clientName: 'Desk', scopes: null };
  const actor = defaultAgentActor('alice', 'Desk');
  const mcpFlags = { pageTitles: 'off', sync: false, source: true, uploads: false };

  const openNode = async () => {
    const assembled = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir } });
    const opened = await assembled.dispatch('blok_open', { documentId: 'doc', write: true }, caller);

    return { assembled, handle: String(opened.structuredContent.handle) };
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    dir = mkdtempSync(join(tmpdir(), 'blok-bundle-mcp-'));
    writeFileSync(join(dir, 'doc.json'), JSON.stringify(docFixture));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it.each([{}, { detail: 'full' }, { ids: ['p2'] }, { depth: 'x' }])('reads %o as Node does', async (view) => {
    const { assembled, handle } = await openNode();

    try {
      const node = await assembled.dispatch('blok_read', { handle, ...view }, caller);

      expect(await call('mcpRead', { mcp: { ...mcpFlags, mode: 'stored' }, document: docFixture, actor, view })).toEqual({ answer: node });
    } finally {
      await assembled.stop();
    }
  });

  it.each([{}, { tool: 'paragraph' }, { command: 'block.insert' }, { tool: 'nope' }])('describes %o as Node does', async (query) => {
    const { assembled, handle } = await openNode();

    try {
      const node = await assembled.dispatch('blok_describe', { handle, ...query }, caller);

      expect(await call('mcpDescribe', { mcp: { ...mcpFlags, mode: 'stored' }, document: docFixture, actor, query })).toEqual({ answer: node });
    } finally {
      await assembled.stop();
    }
  });

  const batches: Array<[string, AgentBatch]> = [
    ['a text edit', { commands: [{ name: 'text.replace', args: { id: 'p1', range: { find: 'world' }, with: 'there' } }] }],
    ['a title', { commands: [{ name: 'doc.setTitle', args: { title: 'Plan <x>  ' } }] }],
    ['a read', { commands: [{ name: 'doc.read', args: {} }] }],
    ['an unknown command', { commands: [{ name: 'nope.nope', args: {} }] }],
    ['a stale revision', { commands: [{ name: 'doc.setTitle', args: { title: 'T' } }], expectRevision: 'old' }],
  ];

  it.each(batches)('executes %s as Node does, saving the same bytes', async (_label, batch) => {
    const { assembled, handle } = await openNode();

    try {
      const node = await assembled.dispatch('blok_execute', { handle, ...batch }, caller);
      const nodeFile = readFileSync(join(dir, 'doc.json'), 'utf-8');
      const ran = await call('agentExecute', {
        mcp: { ...mcpFlags, mode: 'stored', write: true }, document: docFixture, actor, batch, documentText: 'file',
      });
      const delivery = ran.save === true && typeof ran.documentText === 'string'
        ? { durable: true, pending: false, serverSequence: null, savedVersion: createHash('sha256').update(ran.documentText).digest('hex') }
        : undefined;

      expect(ran.save).toBe(delivery !== undefined);
      if (typeof ran.documentText === 'string') {
        expect(ran.documentText).toBe(nodeFile);
      }
      expect(await call('mcpExecuteAnswer', { result: ran.result, ...(delivery !== undefined && { delivery }) })).toEqual({ answer: node });
    } finally {
      await assembled.stop();
    }
  });

  it('refuses a write on a read-only handle before it runs, as Node does', async () => {
    const assembled = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir } });

    try {
      const opened = await assembled.dispatch('blok_open', { documentId: 'doc' }, caller);
      const batch = batches[1][1];
      const node = await assembled.dispatch('blok_execute', { handle: opened.structuredContent.handle, ...batch }, caller);
      const ran = await call('agentExecute', { mcp: { ...mcpFlags, mode: 'stored', write: false }, document: docFixture, actor, batch });

      expect(ran).toMatchObject({ writes: true, save: false, document: docFixture });
      expect(await call('mcpExecuteAnswer', { result: ran.result })).toEqual({ answer: node });
      expect((await call('agentExecute', { mcp: { ...mcpFlags, mode: 'live', write: false }, document: docFixture, actor, batch })).result)
        .toMatchObject({ ok: false, error: { code: 'READ_ONLY', message: 'This handle cannot write to the room.' } });
    } finally {
      await assembled.stop();
    }
  });

  it('answers a save the source refused with the batch warnings, as Node does', async () => {
    const result: AgentResult = { ok: true, revision: 'r', results: [{}], refs: {}, changed: { created: [], updated: ['p1'], moved: [], removed: [] }, warnings: [{ code: 'CORRECTED', message: 'Fixed.' }] };
    const error = surfaceError('DOCUMENT_CHANGED', 'The document changed on disk since you opened it. Read it again, then retry.').agentError;

    expect(await call('mcpExecuteAnswer', { result, failed: { helper: 'surface', error: { code: error.code, message: error.message } } })).toEqual({
      answer: { structuredContent: { ok: false, warnings: result.warnings, error, delivery: { durable: false, pending: false, serverSequence: null, savedVersion: null } }, isError: true },
    });
  });

  it('carries undo steps between calls, as a Node handle keeps them', async () => {
    const { assembled, handle } = await openNode();

    try {
      const edit = batches[0][1];
      const undo: AgentBatch = { commands: [{ name: 'history.undo', args: {} }] };

      await assembled.dispatch('blok_execute', { handle, ...edit }, caller);
      const node = await assembled.dispatch('blok_execute', { handle, ...undo }, caller);
      const first = await call('agentExecute', { mcp: { ...mcpFlags, mode: 'stored', write: true }, document: docFixture, actor, batch: edit, history: {} });
      const second = await call('agentExecute', {
        mcp: { ...mcpFlags, mode: 'stored', write: true }, document: first.document, actor, batch: undo, history: first.history, documentText: 'file',
      });

      expect(second.save).toBe(true);
      expect(second.documentText).toBe(readFileSync(join(dir, 'doc.json'), 'utf-8'));
      expect(await call('mcpExecuteAnswer', {
        result: second.result,
        delivery: { durable: true, pending: false, serverSequence: null, savedVersion: node.structuredContent.delivery === undefined ? null : (node.structuredContent.delivery as { savedVersion: string }).savedVersion },
      })).toEqual({ answer: node });
    } finally {
      await assembled.stop();
    }
  });

  it('reports the host revision in live mode and refuses a stale one', async () => {
    const live = { mcp: { ...mcpFlags, sync: true, mode: 'live', write: true }, document: docFixture, actor, revision: { now: 'l4', afterWrite: 'l5' } };
    const read = await call('mcpRead', { ...live, view: {} });
    const written = await call('agentExecute', { ...live, batch: { commands: [{ name: 'doc.setTitle', args: { title: 'T' } }], expectRevision: 'l4' } });
    const reading = await call('agentExecute', { ...live, batch: { commands: [{ name: 'doc.read', args: {} }] } });
    const stale = await call('agentExecute', { ...live, batch: { commands: [{ name: 'doc.setTitle', args: { title: 'T' } }], expectRevision: 'l3' } });

    expect(read).toMatchObject({ answer: { structuredContent: { revision: 'l4' }, isError: false } });
    expect(written.result).toMatchObject({ ok: true, revision: 'l5' });
    expect(reading.result).toMatchObject({ ok: true, revision: 'l4' });
    expect(stale.result).toMatchObject({ ok: false, error: { code: 'STALE' } });
  });

  it('reports the host revision in a doc.read after a write in the same batch', async () => {
    const live = { mcp: { ...mcpFlags, sync: true, mode: 'live', write: true }, document: docFixture, actor, revision: { now: 'l4', afterWrite: 'l5' } };
    const ran = await call('agentExecute', { ...live, batch: { commands: [{ name: 'doc.setTitle', args: { title: 'T' } }, { name: 'doc.read', args: {} }] } });

    expect(ran.result).toMatchObject({ ok: true, revision: 'l5', results: [{}, { revision: 'l5' }] });
  });

  it('hands a live restore to the host, as blok-mcp restores through the sync server', async () => {
    const versionHistory = {
      versions: [{ version: 'L:2', savedAt: 20, startedAt: 10, actors: ['u1'] }],
      documents: { 'L:1': { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Then' } }] } },
    };
    const ran = await call('agentExecute', {
      mcp: { ...mcpFlags, sync: true, mode: 'live', write: true }, document: docFixture, actor, versionHistory,
      batch: { commands: [{ name: 'history.restore', args: { version: 'L:1' } }] },
    });

    expect(ran.restore).toBe('L:1');
    expect(ran.result).toMatchObject({ ok: true });
  });

  it('points inserted pages at the pages the host created, under page-map with a source', async () => {
    const pageMap = { ...mcpFlags, pageTitles: 'page-map', mode: 'stored', write: true };
    const batch = { commands: [{ name: 'block.insert', args: { type: 'page', id: 'np0', position: 'end' } }] };
    const needed = await call('agentPagesNeeded', { mcp: pageMap, document: docFixture, actor, batch });
    const ran = await call('agentExecute', { mcp: pageMap, document: docFixture, actor, batch, createdPages: ['host-a'] });
    const blocks = isObject(ran.document) && Array.isArray(ran.document.blocks) ? ran.document.blocks : [];

    expect(needed).toEqual({ count: 1 });
    expect(ran.result).toMatchObject({ ok: true });
    expect(blocks.find((block: unknown) => isObject(block) && block.id === 'np0')).toMatchObject({ data: { pageId: 'host-a' } });
  });
});

describe('server runtime MCP approvals', () => {
  const seed: OutputData = {
    blocks: [{
      id: 'db', type: 'database', content: [],
      data: {
        title: 'Payroll',
        schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0', databaseLocked: true }],
        views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
        activeViewId: 'v',
      },
    }],
  };
  const unlock: AgentBatch = { commands: [{ name: 'database.setLock', args: { id: 'db', locked: false } }] };
  const actor = defaultAgentActor('alice', 'Desktop');
  const flags = { pageTitles: 'off', sync: false, source: true, uploads: false, mode: 'stored', write: true };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** blok-mcp's stored agent with the approver sdk-server.ts builds for these replies. */
  const nodeRun = async (replies: unknown, capabilities: unknown) => {
    const contracts = buildMcpContracts({ pageTitles: 'off' });
    const session = createDocumentAgentSession({
      document: loadStoredDocument(seed, contracts.richTextFieldsFor),
      tools: contracts.runtimes,
      contract: contracts.stored,
      actor,
      ports: createHeadlessPorts({ sanitizeFor: type => contracts.runtimes.get(type)?.sanitize, richTextFieldsFor: contracts.richTextFieldsFor }),
    });
    const asked: AgentApprovalRequest[] = [];
    const result = await session.execute(unlock, canElicit(capabilities) ? { approve: elicitationApprover(replies, asked, inputResponse) } : {});

    return { result, asked, output: session.output() };
  };

  it('asks the question blok-mcp asks, and applies nothing', async () => {
    const node = await nodeRun(undefined, { elicitation: {} });
    const question = node.asked[0];
    const ran = await call('agentExecute', { mcp: flags, document: seed, actor, batch: unlock, approval: { capabilities: { elicitation: {} }, clientName: 'Desktop' } });
    const wire = inputRequired.elicit(approvalQuestion(question, 'Desktop'));

    expect(ran).toEqual({ ask: { key: approvalKey(question), ...JSON.parse(JSON.stringify(wire.params ?? {}), (key, value: unknown) => (key === 'mode' ? undefined : value)) } });
    expect(wire.params).toMatchObject({ mode: 'form' });
    expect(node.result.ok).toBe(false);
    expect(JSON.stringify(node.output)).toContain('"databaseLocked":true');
  });

  it.each([
    ['accept with the tick', { action: 'accept', content: { unlock: true } }],
    ['accept without the tick', { action: 'accept', content: {} }],
    ['decline', { action: 'decline' }],
    ['cancel', { action: 'cancel' }],
  ])('answers %s as blok-mcp does', async (_label, reply) => {
    const question = (await nodeRun(undefined, { elicitation: {} })).asked[0];
    const replies = { [approvalKey(question)]: reply };
    const node = await nodeRun(replies, { elicitation: { form: {} } });
    const ran = await call('agentExecute', { mcp: flags, document: seed, actor, batch: unlock, approval: { capabilities: { elicitation: { form: {} } }, replies, clientName: 'Desktop' } });

    expect(ran.result).toEqual(JSON.parse(JSON.stringify(node.result)));
  });

  it.each([
    ['a reply for another question', { other: { action: 'accept', content: { unlock: true } } }, { elicitation: {} }],
    ['no elicitation capability', undefined, {}],
    ['a URL-only client', undefined, { elicitation: { url: {} } }],
  ])('refuses with %s as blok-mcp does', async (_label, replies, capabilities) => {
    const node = await nodeRun(replies, capabilities);
    const ran = await call('agentExecute', { mcp: flags, document: seed, actor, batch: unlock, approval: { capabilities, ...(replies !== undefined && { replies }), clientName: 'Desktop' } });

    expect(ran.result).toEqual(JSON.parse(JSON.stringify(node.result)));
    expect(modelAnswer(node.result)).toMatchObject({ ok: false, error: { code: 'APPROVAL_REQUIRED' } });
  });

  it.each([
    undefined, null, 'x', {}, { k: null }, { k: [] }, { k: 'accept' }, { k: { action: 'accept' } },
    { k: { action: 'accept', content: [] } }, { k: { action: 'accept', content: { unlock: true } } },
    { k: { action: 'decline', content: null } }, { k: { action: 'other' } }, { k: { roots: [] } }, { k: { role: 'user', content: 'x' } },
  ])('reads replies %o as the SDK does, for what the approver uses', (replies) => {
    const sdk = inputResponse(replies as never, 'k');
    const own = readInputResponse(replies, 'k');

    expect(own.kind === 'elicit').toBe(sdk.kind === 'elicit');
    if (sdk.kind === 'elicit' && own.kind === 'elicit' && 'action' in own) {
      expect(own).toEqual(sdk);
    }
  });
});

describe('server runtime CLI operations', () => {
  const nodeParse = (argv: string[], env: Record<string, string>): Record<string, unknown> => {
    try {
      return { ok: JSON.parse(JSON.stringify(parseMcpArgs(argv, env))) };
    } catch (thrown) {
      return { error: thrown instanceof McpConfigError ? thrown.message : 'not a config error' };
    }
  };

  it.each<[string[], Record<string, string>]>([
    [[], {}],
    [['--http', '127.0.0.1:0', '--public'], {}],
    [['--http', '--public'], {}],
    [['--public'], {}],
    [['--auth=oauth'], {}],
    [['--auth', 'oauth'], {}],
    [['--auth', 'oauth', '--oauth-issuer', 'i', '--oauth-audience', 'a', '--oauth-jwks', 'j'], {}],
    [['--auth', 'other'], {}],
    [['x'], {}],
    [['--nope'], {}],
    [['--schema', 'full', '--schema', 'full'], {}],
    [['--handle-idle-ms', '0x10', '--max-handles', '1e3'], {}],
    [['--handle-idle-ms', ' 7 '], {}],
    [['--handle-idle-ms', '1.5'], {}],
    [['--source', 'files:./docs', '--source-list'], {}],
    [['--source', 'endpoint:https://h/docs', '--source-list', 'https://h/list'], { BLOK_DOC_ENDPOINT_AUTH: 'Bearer x' }],
    [['--source', 'ftp:x'], {}],
    [['--rich-text-fields', '{"callout":["title"]}'], {}],
    [['--rich-text-fields', '[1]'], {}],
    [[], { BLOK_RICH_TEXT_FIELDS: '{"a":[1]}' }],
    [['--sync-url', 'ws://h/s', '--origin', 'http://o'], { BLOK_SECRET: 's' }],
    [[], { BLOK_MCP_HTTP: '', BLOK_SYNC_URL: '', BLOK_SECRET: '' }],
    [['--ticket-url', 'https://t'], {}],
    [['--ticket-url', 'https://t'], { BLOK_MCP_HOST_TOKEN: 'tok' }],
    [['--no-comments', '--comments', '--page-titles', 'page-map', '--principal', 'bob'], {}],
    [['--manifest', 'm.json', '--manifest-overrides', 'o.json', '--authorize', 'HTTP://x'], {}],
  ])('parses %o with env %o as Node does', async (argv, env) => {
    expect(await call('mcpParseArgs', { argv, env })).toEqual(nodeParse(argv, env));
  });

  const base: BlokMcpOptions = { transport: { kind: 'stdio' }, auth: { kind: 'none' } };
  const http = (listen: string, extra: Partial<BlokMcpOptions> = {}): BlokMcpOptions =>
    ({ ...base, transport: { kind: 'http', listen }, ...extra });
  const authorize = async (): Promise<boolean> => true;
  const uploader = { uploadByFile: () => Promise.reject(new Error('unused')) };

  it.each<[string, BlokMcpOptions, Record<string, unknown>]>([
    ['stdio', base, {}],
    ['url tickets without a token', { ...base, tickets: { kind: 'url', url: 'u', hostToken: '' } }, {}],
    ['sync without tickets', { ...base, sync: { url: 'ws://x' } }, {}],
    ['a secret over http', http('127.0.0.1:1', { tickets: { kind: 'secret', secret: 's' } }), {}],
    ['a public bind', http('0.0.0.0:1'), {}],
    ['a bracketed loopback', http('[::1]:1', { authorize }), { authorize: true }],
    ['public without auth', { ...base, transport: { kind: 'http', listen: '0.0.0.0:1', public: true } }, {}],
    ['http without authorize', http('localhost:1'), {}],
    ['http with ticket url and no source', http('localhost:1', { tickets: { kind: 'url', url: 'u', hostToken: 't' } }), {}],
    ['uploads without uploadByFile', { ...base, uploads: { uploader: {} as never } }, { uploads: { uploadByFile: false } }],
    ['bad upload limits', { ...base, uploads: { uploader, limits: { image: { maxSize: 0 } } } }, { uploads: { uploadByFile: true, limits: { image: { maxSize: 0 } } } }],
    ['a bad upload kind', { ...base, uploads: { uploader, limits: { doc: {} } as never } }, { uploads: { uploadByFile: true, limits: { doc: {} } } }],
    ['an upload root over http', http('localhost:1', { authorize, uploads: { uploader, root: '/r' } }), { authorize: true, uploads: { uploadByFile: true, root: '/r' } }],
  ])('checks %s as Node does', async (_label, options, flags) => {
    const node = ((): Record<string, unknown> => {
      try {
        checkOptionSafety(options);

        return {};
      } catch (thrown) {
        return { error: thrown instanceof McpConfigError ? thrown.message : 'not a config error' };
      }
    })();
    const { authorize: _hook, uploads: _uploads, ...data } = options;

    expect(await call('mcpCheckOptions', { options: { ...data, ...flags } })).toEqual(node);
  });

  it.each<[string, 'manifest' | 'overrides', unknown]>([
    ['a good manifest', 'manifest', customTools],
    ['a bad manifest', 'manifest', { formatVersion: 2, blocks: [] }],
    ['good overrides', 'overrides', overrides],
    ['overrides that are not an object', 'overrides', []],
    ['an unknown override key', 'overrides', { paragraph: { nope: 1 } }],
    ['bad hiddenActions', 'overrides', { paragraph: { hiddenActions: [1] } }],
  ])('validates %s as Node does', async (_label, kind, value) => {
    const node = ((): Record<string, unknown> => {
      try {
        return { value: JSON.parse(JSON.stringify(kind === 'manifest' ? parseCustomToolsFile(value) : parseOverridesFile(value))) };
      } catch (thrown) {
        return { error: thrown instanceof McpConfigError ? thrown.message : 'not a config error' };
      }
    })();

    expect(await call('mcpConfigFile', { kind, value })).toEqual(node);
  });
});

describe('server runtime files-source operations', () => {
  it.each(['doc', 'a.b-c_d', '-lead', '.hidden', 'a/b', '', 'x'.repeat(201), 'CON', 'nul.json', 'com1', 'lpt9.txt', 'é'])('checks id %o as the files source does', async (id) => {
    const dir = mkdtempSync(join(tmpdir(), 'blok-bundle-ids-'));

    try {
      const source = createFilesSource(dir);
      const node = await source.load(id).then(() => ({}), (thrown: unknown) => ({ error: thrown instanceof McpSurfaceError ? thrown.agentError : 'other' }));

      expect(await call('mcpFileId', { id })).toEqual(node);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each<[Record<string, unknown>]>([
    [{ limit: 25 }],
    [{ limit: 2 }],
    [{ limit: 2, cursor: 'b' }],
    [{ limit: 2, cursor: 'zz' }],
    [{ limit: 25, query: 'ALP' }],
    [{ limit: 25, query: 'second' }],
    [{ limit: 1, query: 'a', cursor: 'A' }],
  ])('lists %o as the files source does', async (request) => {
    const dir = mkdtempSync(join(tmpdir(), 'blok-bundle-list-'));
    const files: Record<string, string> = {
      'b.json': JSON.stringify({ title: 'Second', blocks: [] }),
      'a.json': JSON.stringify({ title: '', blocks: [] }),
      'A.json': JSON.stringify({ title: 'Alpha', blocks: [] }),
      'c.json': 'not json',
      'd.json': JSON.stringify([1]),
      'e.json': '﻿{"title":"Bom","blocks":[]}',
      '.x.json': '{}',
      'bad id!.json': '{}',
      'notes.txt': 'x',
      'z.json': JSON.stringify({ title: 7, blocks: [] }),
    };

    try {
      for (const [name, text] of Object.entries(files)) {
        writeFileSync(join(dir, name), text);
      }
      const names = readdirSync(dir);
      const node = await createFilesSource(dir).list?.(request as { limit: number });
      const ids = await call('mcpFileIds', { names });
      const entries = (ids.ids as string[]).map(id => ({ id, text: readFileSync(join(dir, `${id}.json`), 'utf-8') }));

      expect(await call('mcpFilesList', { entries, ...request })).toEqual(node);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ['a document', '{"blocks":[{"id":"p","type":"paragraph","data":{"text":"\\u2028<é>"}}]}'],
    ['not JSON', '{"blocks":'],
    ['a BOM', '﻿{"blocks":[]}'],
    ['no blocks', '{"title":"x"}'],
    ['an array', '[]'],
  ])('reads %s as the files source does', async (_label, text) => {
    const dir = mkdtempSync(join(tmpdir(), 'blok-bundle-load-'));

    try {
      writeFileSync(join(dir, 'doc.json'), text);
      const node = await createFilesSource(dir).load('doc').then(
        loaded => ({ document: loaded.raw }),
        (thrown: unknown) => ({ error: thrown instanceof McpSurfaceError ? thrown.agentError : 'other' }),
      );

      expect(await call('mcpParseDocument', { id: 'doc', text })).toEqual(node);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes the bytes the files source writes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'blok-bundle-save-'));

    try {
      const source = createFilesSource(dir);
      const saved = await source.save('doc', docFixture, { ifVersion: null });
      const text = await call('mcpDocumentText', { document: docFixture, form: 'file' });

      expect(text.text).toBe(readFileSync(join(dir, 'doc.json'), 'utf-8'));
      expect(createHash('sha256').update(String(text.text)).digest('hex')).toBe(saved.version);
      expect(await call('mcpDocumentText', { document: docFixture, form: 'compact' })).toEqual({ text: JSON.stringify(docFixture) });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('server runtime mcpRoomError', () => {
  it.each(['unsupported-format', 'forbidden', 'unauthorized', 'handshake-timeout', undefined])('maps the room end %o as Node does', async (terminal) => {
    expect(await call('mcpRoomError', terminal === undefined ? {} : { terminal })).toEqual({ error: terminalToError(terminal as never) });
  });
});
