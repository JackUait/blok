// @vitest-environment node
import { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/client';
import { ProtocolErrorCode } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildMcpContracts } from '../../../src/mcp/contract';
import { UnknownToolError } from '../../../src/mcp/dispatcher';
import { buildSdkServer } from '../../../src/mcp/sdk-server';
import { listMcpTools } from '../../../src/mcp/tools';

import type { Caller, ToolOutcome } from '../../../src/mcp/dispatcher';
import type { Dispatch } from '../../../src/mcp/sdk-server';
import type { McpTool } from '../../../src/mcp/tools';

const DEADLINE_MS = 5_000;
const REQUEST = { timeout: DEADLINE_MS, maxTotalTimeout: DEADLINE_MS };
const ERAS: Array<'legacy' | 'modern'> = ['legacy', 'modern'];
const SCHEMAS: Array<'envelope' | 'full'> = ['envelope', 'full'];

const within = async <T>(work: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('SDK fixture deadline exceeded')), DEADLINE_MS);
  });

  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
};

const withClient = async (
  era: 'legacy' | 'modern',
  tools: McpTool[],
  dispatch: Dispatch,
  verify: (client: Client) => Promise<void>,
  clientName = 'Desktop/1.0 (mac)'
): Promise<void> => {
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  const serverTransport = new StdioServerTransport(toServer, toClient);
  const clientTransport = new StdioServerTransport(toClient, toServer);
  const errors: Error[] = [];
  const client = new Client({ name: clientName, version: '1' }, {
    versionNegotiation: era === 'legacy'
      ? { mode: 'legacy' }
      : { mode: { pin: '2026-07-28' }, probe: { timeoutMs: DEADLINE_MS } },
  });
  const serving = serveStdio(() => buildSdkServer({
    tools,
    dispatch,
    caller: (name): Caller => ({ principal: 'local', clientName: name, scopes: null }),
    version: '0.0.0-test',
  }), { transport: serverTransport, onerror: error => errors.push(error) });

  try {
    await within(client.connect(clientTransport, REQUEST));
    expect(client.getProtocolEra()).toBe(era);
    await within(verify(client));
  } finally {
    const closeConnections = async (): Promise<void> => {
      try {
        const closed = await within(Promise.allSettled([
          client.close(),
          clientTransport.close(),
          serverTransport.close(),
        ]));

        expect(closed.every(result => result.status === 'fulfilled')).toBe(true);
      } finally {
        try {
          const serverClosed = new Promise<void>(resolve => toServer.once('close', resolve));
          const clientClosed = new Promise<void>(resolve => toClient.once('close', resolve));

          toServer.destroy();
          toClient.destroy();
          await within(Promise.all([serverClosed, clientClosed]));
        } finally {
          expect(errors).toEqual([]);
        }
      }
    };

    try {
      await within(serving.close());
    } finally {
      await closeConnections();
    }
  }
};

const deploymentTools = (schema: 'envelope' | 'full' = 'envelope'): McpTool[] =>
  listMcpTools(buildMcpContracts({ pageTitles: 'off' }).stored, { schema, handleIdleMs: 600_000 });

const gone: ToolOutcome = {
  structuredContent: { error: { code: 'UNKNOWN_HANDLE', message: 'gone', retryable: false } },
  isError: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(ERAS)('buildSdkServer over real SDK stdio (%s)', era => {
  it.each(SCHEMAS)('serves the supplied six schemas without changing them (%s)', async schema => {
    const tools = deploymentTools(schema);
    const dispatch = vi.fn<Dispatch>(async () => gone);

    await withClient(era, tools, dispatch, async client => {
      const listed = await client.listTools(undefined, { ...REQUEST, cacheMode: 'bypass' });

      expect(listed.tools).toEqual(tools);
      expect(listed.tools).toHaveLength(6);
      expect(client.getServerVersion()).toMatchObject({ name: 'blok-mcp', version: '0.0.0-test' });
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  it('preserves a tool error and emits exactly its JSON as text', async () => {
    const dispatch = vi.fn<Dispatch>(async () => gone);

    await withClient(era, deploymentTools(), dispatch, async client => {
      await client.listTools(undefined, REQUEST);
      const result = await client.callTool({ name: 'blok_read', arguments: { handle: 'missing' } }, REQUEST);

      expect(result.structuredContent).toEqual(gone.structuredContent);
      expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(gone.structuredContent) }]);
      expect(result.isError).toBe(true);
      expect(dispatch).toHaveBeenCalledExactlyOnceWith('blok_read', { handle: 'missing' }, {
        principal: 'local',
        clientName: 'Desktop-1.0--mac-',
        scopes: null,
      });
    });
  });

  it('passes empty arguments and returns a schema-valid lifecycle success', async () => {
    const outcome: ToolOutcome = {
      structuredContent: { documents: [], nextCursor: null, supported: false },
      isError: false,
    };
    const dispatch = vi.fn<Dispatch>(async () => outcome);

    await withClient(era, deploymentTools(), dispatch, async client => {
      await client.listTools(undefined, REQUEST);
      const result = await client.callTool({ name: 'blok_list_documents' }, REQUEST);

      expect(result.structuredContent).toEqual(outcome.structuredContent);
      expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(outcome.structuredContent) }]);
      expect(result.isError).toBe(false);
      expect(dispatch).toHaveBeenCalledExactlyOnceWith('blok_list_documents', {}, {
        principal: 'local',
        clientName: 'Desktop-1.0--mac-',
        scopes: null,
      });
    });
  });

  it('keeps unknown tool names out of the dispatcher', async () => {
    const dispatch = vi.fn<Dispatch>(async () => gone);

    await withClient(era, deploymentTools(), dispatch, async client => {
      await expect(client.callTool({ name: 'blok_delete_everything', arguments: {} }, REQUEST))
        .rejects.toMatchObject({ code: ProtocolErrorCode.InvalidParams });
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  it('maps the dispatcher unknown-tool error to a protocol error', async () => {
    const dispatch = vi.fn<Dispatch>(async () => {
      throw new UnknownToolError('blok_read');
    });

    await withClient(era, deploymentTools(), dispatch, async client => {
      await expect(client.callTool({ name: 'blok_read', arguments: { handle: 'h' } }, REQUEST))
        .rejects.toMatchObject({ code: ProtocolErrorCode.InvalidParams });
      expect(dispatch).toHaveBeenCalledTimes(1);
    });
  });

  it('does not turn an unexpected dispatcher failure into a model-fixable tool error', async () => {
    const dispatch = vi.fn<Dispatch>(async () => {
      throw new Error('dependency failed');
    });

    await withClient(era, deploymentTools(), dispatch, async client => {
      await expect(client.callTool({ name: 'blok_read', arguments: { handle: 'h' } }, REQUEST))
        .rejects.toMatchObject({ code: ProtocolErrorCode.InternalError });
    });
  });

  it('keeps the declared output schema active at the actual SDK client', async () => {
    const dispatch = vi.fn<Dispatch>(async () => ({
      structuredContent: { documents: 'not-an-array', nextCursor: null, supported: false },
      isError: false,
    }));

    await withClient(era, deploymentTools(), dispatch, async client => {
      await client.listTools(undefined, REQUEST);
      await expect(client.callTool({ name: 'blok_list_documents' }, REQUEST))
        .rejects.toMatchObject({ code: ProtocolErrorCode.InvalidParams });
    });
  });
});
