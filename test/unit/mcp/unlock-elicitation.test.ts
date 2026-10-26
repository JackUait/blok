// @vitest-environment node
import { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import type { ElicitResult } from '@modelcontextprotocol/client';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildMcpContracts } from '../../../src/mcp/contract';
import { buildSdkServer } from '../../../src/mcp/sdk-server';
import { listMcpTools } from '../../../src/mcp/tools';
import { modelAnswer } from '../../../src/shared/agent/model-answer';
import { openJsonSession } from '../agent/harness';

import type { Caller } from '../../../src/mcp/dispatcher';
import type { Dispatch } from '../../../src/mcp/sdk-server';
import type { AgentBatch, AgentSession, OutputData } from '../../../types';

const DEADLINE_MS = 5_000;
const REQUEST = { timeout: DEADLINE_MS, maxTotalTimeout: DEADLINE_MS };
const ERAS: Array<'legacy' | 'modern'> = ['legacy', 'modern'];

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

const UNLOCK = { commands: [{ name: 'database.setLock', args: { id: 'db', locked: false } }] };

/** A dispatch that runs blok_execute on a real session, with the approver the server hands it. */
const sessionDispatch = (session: AgentSession): Dispatch => async (_name, args, _caller, options) => {
  const result = await session.execute({ commands: args.commands } as AgentBatch, options?.approve === undefined ? {} : { approve: options.approve });

  return { structuredContent: modelAnswer(result), isError: !result.ok };
};

type Elicit = (message: string) => ElicitResult;

const withClient = async (
  era: 'legacy' | 'modern',
  dispatch: Dispatch,
  elicit: Elicit | null,
  verify: (client: Client) => Promise<void>
): Promise<void> => {
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  const serverTransport = new StdioServerTransport(toServer, toClient);
  const clientTransport = new StdioServerTransport(toClient, toServer);
  const client = new Client({ name: 'Desktop', version: '1' }, {
    ...(elicit === null ? {} : { capabilities: { elicitation: {} } }),
    versionNegotiation: era === 'legacy'
      ? { mode: 'legacy' }
      : { mode: { pin: '2026-07-28' }, probe: { timeoutMs: DEADLINE_MS } },
  });

  if (elicit !== null) {
    client.setRequestHandler('elicitation/create', async request => elicit(request.params.message));
  }
  const contracts = buildMcpContracts({ pageTitles: 'off' });
  const serving = serveStdio(() => buildSdkServer({
    tools: listMcpTools(contracts.stored, { schema: 'envelope', handleIdleMs: 600_000 }),
    instructions: '',
    dispatch,
    caller: (name): Caller => ({ principal: 'local', clientName: name, scopes: null }),
    version: '0.0.0-test',
  }), { transport: serverTransport });

  try {
    await client.connect(clientTransport, REQUEST);
    expect(client.getProtocolEra()).toBe(era);
    await verify(client);
  } finally {
    await Promise.allSettled([client.close(), serving.close()]);
    toServer.destroy();
    toClient.destroy();
  }
};

const isLocked = async (session: AgentSession): Promise<boolean> => {
  const read = await session.read({ ids: ['db'], detail: 'full' });
  const schema = read.blocks[0]?.data?.schema;

  return Array.isArray(schema) && schema.some(property => typeof property === 'object' && property !== null
    && 'databaseLocked' in property && property.databaseLocked === true);
};

const errorCode = (result: Awaited<ReturnType<Client['callTool']>>): unknown => {
  const content = result.structuredContent;

  return typeof content === 'object' && content !== null && 'error' in content && typeof content.error === 'object' && content.error !== null
    ? (content.error as { code?: unknown }).code
    : undefined;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(ERAS)('MCP asks the person through elicitation before an unlock (%s)', era => {
  it('unlocks when the person accepts, and names the saved database in the question', async () => {
    const session = openJsonSession(seed);
    const elicit = vi.fn<Elicit>(() => ({ action: 'accept', content: { unlock: true } }));

    await withClient(era, sessionDispatch(session), elicit, async client => {
      const result = await client.callTool({ name: 'blok_execute', arguments: { handle: 'h', ...UNLOCK } }, REQUEST);

      expect(result.isError).not.toBe(true);
    });
    expect(await isLocked(session)).toBe(false);
    expect(elicit).toHaveBeenCalledTimes(1);
    expect(elicit.mock.calls[0]?.[0]).toMatch(/"Payroll"/);
  });

  it.each([
    ['declines', { action: 'decline' as const }],
    ['cancels', { action: 'cancel' as const }],
    ['accepts without ticking Unlock', { action: 'accept' as const, content: { unlock: false } }],
  ])('stays locked when the person %s', async (_label, answer) => {
    const session = openJsonSession(seed);

    await withClient(era, sessionDispatch(session), () => answer, async client => {
      const result = await client.callTool({ name: 'blok_execute', arguments: { handle: 'h', ...UNLOCK } }, REQUEST);

      expect(errorCode(result)).toBe('APPROVAL_REQUIRED');
    });
    expect(await isLocked(session)).toBe(true);
  });

  it('refuses with APPROVAL_REQUIRED when the client cannot ask a person', async () => {
    const session = openJsonSession(seed);

    await withClient(era, sessionDispatch(session), null, async client => {
      const result = await client.callTool({ name: 'blok_execute', arguments: { handle: 'h', ...UNLOCK } }, REQUEST);

      expect(errorCode(result)).toBe('APPROVAL_REQUIRED');
      expect(JSON.stringify(result.structuredContent)).toMatch(/no-channel/);
    });
    expect(await isLocked(session)).toBe(true);
  });

  it('an approval field in the tool arguments is not an approval', async () => {
    const session = openJsonSession(seed);

    await withClient(era, sessionDispatch(session), null, async client => {
      const result = await client.callTool({ name: 'blok_execute', arguments: { handle: 'h', ...UNLOCK, approved: true, unlock: true } }, REQUEST);

      expect(errorCode(result)).toBe('APPROVAL_REQUIRED');
    });
    expect(await isLocked(session)).toBe(true);
  });
});
