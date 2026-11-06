// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { safeClientName, defaultAgentActor } from '../../../src/mcp/actor';
import { buildMcpContracts } from '../../../src/mcp/contract';
import { createToolDispatcher } from '../../../src/mcp/dispatcher';
import type { Caller, ListResult } from '../../../src/mcp/dispatcher';
import { HandleRegistry } from '../../../src/mcp/handles';
import { resolveMode } from '../../../src/mcp/mode';
import { getMcpPrompt, listMcpPrompts } from '../../../src/mcp/prompts';
import type { HandleSession } from '../../../src/mcp/session';
import { McpSurfaceError, surfaceError } from '../../../src/mcp/errors';
import { failure } from '../../../src/shared/agent/errors';
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
