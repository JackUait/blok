// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcpHandler, McpServer, Server } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthInfo, CallToolRequest, ServerContext } from '@modelcontextprotocol/server';

import { getBlokVersion } from '../../../src/components/utils/version';
import { McpConfigError } from '../../../src/mcp/config';
import { createBlok } from '../../../src/mcp/embed';
import { parseBlokMcpArgs } from '../../../src/mcp/index';
import { listMcpPrompts } from '../../../src/mcp/prompts';
import { assembleMcp } from '../../../src/mcp/server';

import type { BlokMcp, BlokMcpHostSurface, CreateBlokHooks } from '../../../src/mcp/embed';
import type { BlokMcpOptions } from '../../../src/mcp/options';

const MODERN = '2026-07-28';
const HOST_TOOL = { name: 'host_echo', description: 'Echoes text.', inputSchema: { type: 'object' as const, properties: { text: { type: 'string' } } } };
const HOST_PROMPT = { name: 'host_hello', description: 'Says hello.' };

interface Rpc { result?: Record<string, unknown>; error?: { code: number; message: string } }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const opened: BlokMcp[] = [];
const dirs: string[] = [];

const docsDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'blok-embed-'));

  dirs.push(dir);
  await writeFile(join(dir, 'doc.json'), JSON.stringify({ blocks: [] }));

  return dir;
};

const embed = async (
  options: Partial<BlokMcpOptions> = {},
  hooks?: CreateBlokHooks,
): Promise<{ blok: BlokMcp; authorize: ReturnType<typeof vi.fn<(principal: string, documentId: string, write: boolean) => Promise<boolean>>> }> => {
  const authorize = vi.fn<(principal: string, documentId: string, write: boolean) => Promise<boolean>>().mockResolvedValue(true);
  const blok = createBlok({ source: { kind: 'files', dir: await docsDir() }, authorize, ...options }, hooks);

  opened.push(blok);

  return { blok, authorize };
};

const hostServer = (blok: BlokMcp, host: BlokMcpHostSurface = {}): Server => {
  const server = new Server({ name: 'host-example', version: '9.9.9' }, { instructions: `Host instructions.\n\n${blok.instructions}` });

  blok.attach(server, host);

  return server;
};

/** One request to a per-request host server, the way createMcpHandler serves HTTP. */
const call = async (
  build: () => Server,
  method: string,
  params: Record<string, unknown> = {},
  authInfo?: AuthInfo,
): Promise<Rpc> => {
  const handler = createMcpHandler(() => build());

  try {
    const response = await handler.fetch(new Request('http://127.0.0.1/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': MODERN,
        'mcp-method': method,
        ...(typeof params.name === 'string' && { 'mcp-name': params.name }),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': MODERN,
            'io.modelcontextprotocol/clientInfo': { name: 'Desktop', version: '1' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    }), authInfo === undefined ? undefined : { authInfo });
    const body: unknown = JSON.parse(await response.text());

    if (!isRecord(body)) {
      throw new Error('not a JSON-RPC answer');
    }

    return body;
  } finally {
    await handler.close();
  }
};

const alice: AuthInfo = { token: 't', clientId: 'app', scopes: [], extra: { sub: 'alice' } };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(opened.splice(0).map(blok => blok.close()));
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('createBlok', () => {
  it('names the instructions, tools, prompts and version a host composes with', async () => {
    const { blok } = await embed();
    const standalone = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir: '/x' } });

    try {
      expect(blok.instructions).toBe(standalone.instructions);
      expect(blok.toolNames).toEqual(standalone.tools.map(tool => tool.name));
      expect(blok.promptNames).toEqual(listMcpPrompts().map(prompt => prompt.name));
      expect(blok.version).toBe(getBlokVersion());
    } finally {
      await standalone.stop();
    }
  });

  it('lists the host tools and Blok tools, with Blok entries equal to the standalone ones', async () => {
    const { blok } = await embed();
    const standalone = assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, source: { kind: 'files', dir: '/x' } });

    try {
      const answer = await call(() => hostServer(blok, { tools: [HOST_TOOL] }), 'tools/list');
      const tools = answer.result?.tools;

      expect(Array.isArray(tools)).toBe(true);
      expect(JSON.parse(JSON.stringify(tools))).toEqual(JSON.parse(JSON.stringify([HOST_TOOL, ...standalone.tools])));
    } finally {
      await standalone.stop();
    }
  });

  it('keeps the host serverInfo and instructions, and only adds the tools and prompts capabilities', async () => {
    const { blok } = await embed();
    const answer = await call(() => hostServer(blok), 'server/discover');

    expect(answer.result?.instructions).toBe(`Host instructions.\n\n${blok.instructions}`);
    expect(answer.result?.capabilities).toEqual({ tools: {}, prompts: {} });
    expect(answer.result?._meta).toEqual({ 'io.modelcontextprotocol/serverInfo': { name: 'host-example', version: '9.9.9' } });
  });

  it('keeps a capability object the host already set', async () => {
    const { blok } = await embed();
    const answer = await call(() => {
      const server = new Server({ name: 'host-example', version: '1' }, { capabilities: { tools: { listChanged: true } } });

      blok.attach(server);

      return server;
    }, 'server/discover');

    expect(answer.result?.capabilities).toEqual({ tools: { listChanged: true }, prompts: {} });
  });

  it('sends other tool and prompt names to the host', async () => {
    const { blok } = await embed();
    const host: BlokMcpHostSurface = {
      tools: [HOST_TOOL],
      prompts: [HOST_PROMPT],
      callTool: async request => ({ content: [{ type: 'text', text: `echo ${String(request.params.arguments?.text)}` }] }),
      getPrompt: async request => ({ messages: [{ role: 'user', content: { type: 'text', text: `hello from ${request.params.name}` } }] }),
    };

    expect((await call(() => hostServer(blok, host), 'tools/call', { name: 'host_echo', arguments: { text: 'hi' } })).result?.content)
      .toEqual([{ type: 'text', text: 'echo hi' }]);
    expect((await call(() => hostServer(blok, host), 'prompts/get', { name: 'host_hello' })).result?.messages)
      .toEqual([{ role: 'user', content: { type: 'text', text: 'hello from host_hello' } }]);
    expect(((await call(() => hostServer(blok, host), 'prompts/list')).result?.prompts as Array<{ name: string }>).map(prompt => prompt.name))
      .toEqual(['host_hello', ...blok.promptNames]);
  });

  it('refuses a host tool or prompt that takes a Blok name, before serving', async () => {
    const { blok } = await embed();

    expect(() => hostServer(blok, { tools: [{ ...HOST_TOOL, name: 'blok_open' }] })).toThrow(/blok_open/);
    expect(() => hostServer(blok, { prompts: [{ name: blok.promptNames[0] }] })).toThrow(new RegExp(blok.promptNames[0]));
  });

  it('refuses a server whose tool handlers the host already set, instead of replacing them', async () => {
    const { blok } = await embed();
    const mcp = new McpServer({ name: 'host-example', version: '1' });

    mcp.registerTool('host_echo', { description: 'Echoes.' }, () => ({ content: [] }));

    expect(() => blok.attach(mcp)).toThrow(/tools\/list/);
  });

  it('serves a named caller and asks the per-document check with that principal', async () => {
    const { blok, authorize } = await embed();
    const answer = await call(() => hostServer(blok), 'tools/call', { name: 'blok_open', arguments: { documentId: 'doc' } }, alice);

    expect(answer.result?.isError).toBe(false);
    expect(answer.result?.structuredContent).toMatchObject({ mode: 'stored', exists: true });
    expect(authorize).toHaveBeenCalledWith('alice', 'doc', false);
  });

  it('refuses an anonymous caller with a protocol error by default', async () => {
    const { blok, authorize } = await embed();
    const answer = await call(() => hostServer(blok), 'tools/call', { name: 'blok_open', arguments: { documentId: 'doc' } });

    expect(answer.error).toEqual({ code: -32600, message: 'Blok needs a signed-in caller.' });
    expect(authorize).not.toHaveBeenCalled();
  });

  it('refuses a signed-in caller without a name', async () => {
    const { blok } = await embed();
    const unnamed: AuthInfo = { token: 't', clientId: 'app', scopes: [] };
    const answer = await call(() => hostServer(blok), 'tools/call', { name: 'blok_open', arguments: { documentId: 'doc' } }, unnamed);

    expect(answer.error).toEqual({ code: -32600, message: 'Blok needs a named caller (sub or NameIdentifier).' });
  });

  it('serves anonymous callers as anonymousPrincipal when the host opts out', async () => {
    const { blok, authorize } = await embed({}, { anonymousPrincipal: 'guest' });
    const answer = await call(() => hostServer(blok), 'tools/call', { name: 'blok_open', arguments: { documentId: 'doc' } });

    expect(answer.result?.isError).toBe(false);
    expect(authorize).toHaveBeenCalledWith('guest', 'doc', false);
  });

  it('takes the identity from the host caller hook, which may be async', async () => {
    const caller = vi.fn<NonNullable<CreateBlokHooks['caller']>>().mockResolvedValue({ principal: 'bob' });
    const { blok, authorize } = await embed({}, { caller });

    await call(() => hostServer(blok), 'tools/call', { name: 'blok_open', arguments: { documentId: 'doc' } });

    expect(authorize).toHaveBeenCalledWith('bob', 'doc', false);
    expect(caller).toHaveBeenCalledTimes(1);
  });

  it('keeps one handle across per-request servers', async () => {
    const { blok } = await embed();
    const open = await call(() => hostServer(blok), 'tools/call', { name: 'blok_open', arguments: { documentId: 'doc' } }, alice);
    const handle = (open.result?.structuredContent as { handle: string }).handle;
    const read = await call(() => hostServer(blok), 'tools/call', { name: 'blok_read', arguments: { handle } }, alice);

    expect(read.result?.isError).toBe(false);
  });

  it('gives low-level handlers for a host that composes its own', async () => {
    const { blok } = await embed();
    const answer = await call(() => {
      const server = new Server({ name: 'host-example', version: '1' }, { capabilities: { tools: {} } });
      const handlers = blok.handlers(server);

      server.setRequestHandler('tools/list', () => ({ tools: [HOST_TOOL, ...handlers.listTools().tools] }));
      server.setRequestHandler('tools/call', (request: CallToolRequest, ctx: ServerContext) => handlers.callTool(request, ctx));

      return server;
    }, 'tools/call', { name: 'blok_open', arguments: { documentId: 'doc' } }, alice);

    expect(answer.result?.isError).toBe(false);
  });

  it('checks the names a handlers() host passes, as attach does', async () => {
    const { blok } = await embed();
    const server = new Server({ name: 'host-example', version: '1' }, { capabilities: { tools: {}, prompts: {} } });

    expect(() => blok.handlers(server, { tools: [{ name: 'blok_open' }], prompts: [{ name: 'improve' }] }))
      .toThrow("Blok already serves blok_open, improve: rename the host's tool or prompt");
    expect(() => blok.handlers(server, { tools: [HOST_TOOL], prompts: [HOST_PROMPT] })).not.toThrow();
  });

  it('ignores the host token\'s scopes by default: a signed-in user without blok scopes can write', async () => {
    const { blok } = await embed();
    const readOnly: AuthInfo = { token: 't', clientId: 'app', scopes: ['blok.read'], extra: { sub: 'alice' } };
    const open = await call(() => hostServer(blok), 'tools/call', { name: 'blok_open', arguments: { documentId: 'doc', write: true } }, readOnly);

    expect(open.result?.isError).toBe(false);
  });

  it('enforces scopes the caller hook returns, as standalone does', async () => {
    const { blok } = await embed({}, { caller: () => ({ principal: 'alice', scopes: ['blok.read'] }) });
    const open = await call(() => hostServer(blok), 'tools/call', { name: 'blok_open', arguments: { documentId: 'doc', write: true } });

    expect(open.result?.isError).toBe(true);
    expect(JSON.stringify(open.result?.structuredContent)).toContain('blok.write');
  });

  it('binds a handle to its opener: another principal gets UNKNOWN_HANDLE', async () => {
    const { blok } = await embed();
    const open = await call(() => hostServer(blok), 'tools/call', { name: 'blok_open', arguments: { documentId: 'doc' } }, alice);
    const handle = (open.result?.structuredContent as { handle: string }).handle;
    const bob: AuthInfo = { token: 't', clientId: 'app', scopes: [], extra: { sub: 'bob' } };
    const read = await call(() => hostServer(blok), 'tools/call', { name: 'blok_read', arguments: { handle } }, bob);

    expect(read.result?.structuredContent).toMatchObject({ error: { code: 'UNKNOWN_HANDLE' } });
  });

  it('stops once and keeps stopped', async () => {
    const { blok } = await embed();

    await blok.close();
    await expect(blok.close()).resolves.toBeUndefined();
  });

  describe('options', () => {
    const base = { source: { kind: 'files' as const, dir: '/docs' }, authorize: async (): Promise<boolean> => true };

    it("refuses Blok's own OAuth: the host authenticates callers", () => {
      expect(() => createBlok({ ...base, auth: { kind: 'oauth', issuer: 'https://i', audience: 'https://a', jwksUrl: 'https://j' } }))
        .toThrow(new McpConfigError("Blok's own OAuth is for the standalone server; on a host server the host signs callers in (pass caller)"));
    });

    it('refuses principal, which only names the standalone caller', () => {
      expect(() => createBlok({ ...base, principal: 'local' }))
        .toThrow(new McpConfigError('principal names the standalone caller; on a host server use caller, or anonymousPrincipal'));
    });

    it('needs the per-document check whatever the transport says', () => {
      expect(() => createBlok({ source: base.source, transport: { kind: 'stdio' } }))
        .toThrow(new McpConfigError('Blok on a host server needs a per-document check: pass authorize (--authorize), or serve live rooms only with --ticket-url and no source'));
    });

    it('refuses an empty anonymousPrincipal', () => {
      expect(() => createBlok(base, { anonymousPrincipal: '' }))
        .toThrow(new McpConfigError('anonymousPrincipal must be a non-empty string'));
    });

    it('ignores the transport, so bind rules never apply', () => {
      expect(() => opened.push(createBlok({ ...base, transport: { kind: 'http', listen: '0.0.0.0:80' } }))).not.toThrow();
    });
  });
});

describe('parseBlokMcpArgs', () => {
  it('reads the blok-mcp flags and env, with the authorize webhook loaded', async () => {
    const options = await parseBlokMcpArgs(['--source', 'files:/docs', '--authorize', 'http://127.0.0.1:9/authorize'], {});

    expect(options.source).toEqual({ kind: 'files', dir: '/docs' });
    expect(typeof options.authorize).toBe('function');
    expect(options.transport).toEqual({ kind: 'stdio' });
  });

  it('refuses an unknown flag with the CLI wording', async () => {
    await expect(parseBlokMcpArgs(['--nope'], {})).rejects.toThrow(new McpConfigError('Unknown flag --nope'));
  });

  it('makes the files handle store for --handle-store files:<dir>, and none for memory', async () => {
    const store = (await parseBlokMcpArgs(['--handle-store', 'files:/var/blok/handles'], {})).handleStore;

    expect(store).toEqual({ count: expect.any(Function), tryAdd: expect.any(Function), acquire: expect.any(Function), remove: expect.any(Function) });
    expect((await parseBlokMcpArgs(['--handle-store', 'memory'], {})).handleStore).toBeUndefined();
    expect((await parseBlokMcpArgs([], {})).handleStore).toBeUndefined();
  });
});
