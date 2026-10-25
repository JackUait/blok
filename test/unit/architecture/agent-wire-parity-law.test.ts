// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgentTurn } from '../../../src/components/modules/api/agent-turn';
import { createToolDispatcher } from '../../../src/mcp/dispatcher';
import type { Caller, ToolOutcome } from '../../../src/mcp/dispatcher';
import { HandleRegistry } from '../../../src/mcp/handles';
import type { HandleSession } from '../../../src/mcp/session';
import { createDocumentAgentSession } from '../../../src/shared/agent';
import { createHeadlessAgentSetup } from '../../../src/view/agent-runtime';

/*
 * Law: Ask AI (agent-turn) and MCP (dispatcher) give a model the same answer for the same
 * blok_read / blok_describe / blok_execute call. Both go through src/shared/agent/tool-call.ts.
 *
 * Exempt, on purpose:
 * - an unknown tool name: MCP refuses it at the protocol layer (sdk-server), before the dispatcher;
 * - input that is not an object (a JSON string, an array): MCP arguments are always an object;
 * - `page` when Ask AI can open sub-pages: MCP reaches them with blok_open, so Ask AI here runs without openPage.
 */

const caller: Caller = { principal: 'alice', clientName: 'test', scopes: null };
const ROOT = resolve(__dirname, '../../..');

const setup = createHeadlessAgentSetup({ runtime: 'node' });
type DocumentAgent = ReturnType<typeof createDocumentAgentSession>;

const sessions: DocumentAgent[] = [];
const registries: HandleRegistry<HandleSession>[] = [];

const openAgent = (): DocumentAgent => {
  const agent = createDocumentAgentSession({
    document: { title: 'T', blocks: [{ id: 'p1', type: 'paragraph', data: { text: [{ text: 'Hello' }] } }] },
    tools: setup.tools,
    contract: setup.contract,
    ports: setup.ports,
    actor: { id: 'agent', name: 'Agent', kind: 'agent' },
  });

  sessions.push(agent);

  return agent;
};

const NO_DELIVERY = { durable: false, pending: false, serverSequence: null, savedVersion: null };

const callMcp = async (name: string, args: Record<string, unknown>): Promise<ToolOutcome> => {
  const agent = openAgent();
  const session: HandleSession = {
    mode: 'stored',
    write: true,
    durability: 'saved-on-execute',
    contractRevision: setup.contract.revision,
    read: viewArgs => agent.read(viewArgs),
    describe: query => agent.describe(query),
    execute: async batch => ({ ...await agent.execute(batch), delivery: NO_DELIVERY }),
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
  const handle = opened.structuredContent.handle;

  if (typeof handle !== 'string') {
    throw new Error('blok_open returned no handle');
  }

  return dispatch(name, { ...args, handle }, caller);
};

const callAsk = async (name: string, input: unknown): Promise<{ content: unknown; isError: boolean }> => {
  const turn = createAgentTurn(openAgent(), {
    onExecuted: () => undefined,
    onClosed: () => undefined,
    isEditorDestroyed: () => false,
  });
  const result = await turn.call(name, input);

  turn.end();

  return { content: JSON.parse(result.content) as unknown, isError: result.isError };
};

const withoutDelivery = (content: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(content).filter(([key]) => key !== 'delivery'));

const TITLE = { name: 'doc.setTitle', args: { title: 'New' } };

const MATRIX: Array<[label: string, tool: string, args: Record<string, unknown>]> = [
  ['read valid', 'blok_read', {}],
  ['read bad view arg', 'blok_read', { detail: 5 }],
  ['read unknown key', 'blok_read', { bogus: 1 }],
  ['read with page', 'blok_read', { page: 'p1' }],
  ['read with empty page', 'blok_read', { page: '' }],
  ['read {invalidJson}', 'blok_read', { invalidJson: '{"det' }],
  ['describe index', 'blok_describe', {}],
  ['describe a tool', 'blok_describe', { tool: 'paragraph' }],
  ['describe tool:123', 'blok_describe', { tool: 123 }],
  ['describe command:123', 'blok_describe', { command: 123 }],
  ['describe unknown tool', 'blok_describe', { tool: 'nope' }],
  ['describe unknown command', 'blok_describe', { command: 'nope.x' }],
  ['describe unknown key', 'blok_describe', { bogus: 1 }],
  ['describe with page', 'blok_describe', { page: 'p1' }],
  ['execute commands not array', 'blok_execute', { commands: 'x' }],
  ['execute commands missing', 'blok_execute', {}],
  ['execute commands []', 'blok_execute', { commands: [] }],
  ['execute entry null', 'blok_execute', { commands: [null] }],
  ['execute entry without name', 'blok_execute', { commands: [{ args: {} }] }],
  ['execute two bad entries', 'blok_execute', { commands: [null, 5] }],
  ['execute expectRevision 5', 'blok_execute', { commands: [TITLE], expectRevision: 5 }],
  ['execute stale expectRevision', 'blok_execute', { commands: [TITLE], expectRevision: 'h0' }],
  ['execute success', 'blok_execute', { commands: [TITLE] }],
  ['execute BLOCK_NOT_FOUND', 'blok_execute', { commands: [{ name: 'block.delete', args: { id: 'zzz' } }] }],
  ['execute unknown command', 'blok_execute', { commands: [{ name: 'nope.x', args: {} }] }],
  ['execute with page', 'blok_execute', { commands: [TITLE], page: 'p1' }],
  ['execute unknown key', 'blok_execute', { commands: [TITLE], bogus: 1 }],
  ['execute {invalidJson}', 'blok_execute', { invalidJson: '{"comm' }],
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  await Promise.all(registries.splice(0).map(registry => registry.closeAll(async () => undefined)));
  sessions.splice(0).forEach(session => session.close());
  vi.restoreAllMocks();
});

describe('agent wire parity law', () => {
  it.each(MATRIX)('%s: MCP and Ask AI give the model the same answer', async (_label, tool, args) => {
    const mcp = await callMcp(tool, args);
    const ask = await callAsk(tool, args);

    expect(ask.content).toEqual(withoutDelivery(mcp.structuredContent));
    expect(ask.isError).toBe(mcp.isError);
  });

  it('MCP refuses `page` on execute and leaves the document as it was', async () => {
    const mcp = await callMcp('blok_execute', { commands: [TITLE], page: 'p1' });

    expect(mcp.isError).toBe(true);
    expect(mcp.structuredContent).toMatchObject({ ok: false, error: { code: 'COMMAND_UNAVAILABLE' } });
    expect(sessions.map(session => session.output().title)).toEqual(['T']);
  });

  it.each([
    ['blok_describe', { bogus: 1 }, '/bogus'],
    ['blok_describe', { page: 'p1' }, '/page'],
    ['blok_execute', { commands: [TITLE], bogus: 1 }, '/bogus'],
  ])('%s refuses the unknown argument in %o on both sides', async (tool, args, path) => {
    const mcp = await callMcp(tool, args);

    expect(mcp.structuredContent).toMatchObject({ error: { code: 'INVALID_ARGS', path } });
    expect(mcp.isError).toBe(true);
  });

  it('a JSON-string input reads like the object it holds, on Ask AI', async () => {
    expect(await callAsk('blok_read', '{}')).toEqual(await callAsk('blok_read', {}));
  });

  it.each([
    ['dispatcher', 'src/mcp/dispatcher.ts'],
    ['agent turn', 'src/components/modules/api/agent-turn.ts'],
  ])('the %s leaves argument checks and error envelopes to the shared tool-call module', (_label, file) => {
    const text = readFileSync(resolve(ROOT, file), 'utf8');

    expect(text).toMatch(/from '[./]+(?:shared\/agent\/)?tool-call'/);
    // A parsed ToolCall may be read (call.page); raw arguments may not.
    expect(text).not.toMatch(/\.(?:commands|expectRevision|invalidJson)\b/);
    expect(text).not.toMatch(/\b(?:args|input|value|rest|raw)\.(?:tool|command|page)\b/);
    expect(text).not.toMatch(/Array\.isArray\([^)]*commands/);
    expect(text).not.toMatch(/\{\s*ok:\s*false/);
  });
});
