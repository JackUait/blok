// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it as baseIt } from 'vitest';
import * as Y from 'yjs';
import { blokTicket } from '../../../packages/server/src/ticket';
import { createCollabProvider } from '../../../src/components/modules/collaboration/provider';
import type { CollabDocSeam, CollabProvider } from '../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';
import type { Caller } from '../../../src/mcp/dispatcher';
import { nodeSocketFactory } from '../../../src/mcp/live/node-socket';
import type { BlokMcpOptions } from '../../../src/mcp/options';
import { assembleMcp, type AssembledMcp } from '../../../src/mcp/server';
import { htmlToSegmentsNode } from '../../../src/view/rich-text-node';
import { startDocEndpoint } from './doc-endpoint';
import { startServer } from './run-against';

/**
 * Live mode against the built C# host: the MCP agent is a real socket member
 * with its own verified identity. Same gate as blok-client-contract.test.ts.
 */
const it = baseIt.skipIf(process.env.BLOK_CONFORMANCE_SERVER === undefined || process.env.BLOK_CONFORMANCE_SERVER === '');

const SECRET = 'mcp-conformance-secret-0123456789abcdef';
const ORIGIN = 'https://app.example.com';
const DOC = 'mcp-doc';
const HUMAN = 'alice';
const AGENT_ID = 'agent:alice:claude-code';
const DEADLINE_MS = 15_000;
const caller: Caller = { principal: HUMAN, clientName: 'claude-code', scopes: null };

const waitFor = async (predicate: () => boolean, what: () => string): Promise<void> => {
  const deadline = Date.now() + DEADLINE_MS;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what()}`);
    }
    await new Promise((done) => setTimeout(done, 25));
  }
};

/**
 * The MCP server under test, live mode only, built from options alone:
 * `assembleMcp` mints each handle's ticket (`user` = the agent actor id).
 */
const mcpFor = (wsUrl: string, tickets: NonNullable<BlokMcpOptions['tickets']> = { kind: 'secret', secret: SECRET }): AssembledMcp =>
  assembleMcp({ transport: { kind: 'stdio' }, auth: { kind: 'none' }, sync: { url: wsUrl, origin: ORIGIN }, tickets });

const HOST_TOKEN = 'mcp-conformance-host-token';

/**
 * A host ticket route that grants read only, whatever the agent asked for:
 * the ticket-URL case where the host, not the MCP server, decides access.
 */
const startReadOnlyTicketHost = async (): Promise<{ url: string; close(): Promise<void> }> => {
  const server = createServer((request, response) => {
    let body = '';

    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      const asked: unknown = JSON.parse(body);

      if (request.headers.authorization !== `Bearer ${HOST_TOKEN}`
        || typeof asked !== 'object' || asked === null
        || !('actorId' in asked) || typeof asked.actorId !== 'string'
        || !('doc' in asked) || typeof asked.doc !== 'string') {
        response.writeHead(403);
        response.end();

        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ticket: blokTicket(SECRET, { user: asked.actorId, doc: asked.doc, write: false, ttlSeconds: 600 }) }));
    });
  });

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('Ticket host has no TCP address');
  }

  return {
    url: `http://127.0.0.1:${address.port}/mcp-tickets`,
    close: () => new Promise((done) => {
      server.close(() => done());
      server.closeAllConnections();
    }),
  };
};

interface Human { store: DocumentStore; provider: CollabProvider; identities: Array<{ clientId: number; actorId: string }>; destroy(): void }

const connectHuman = (wsUrl: string): Human => {
  const store = new DocumentStore(new YBlockSerializer({ htmlToSegments: htmlToSegmentsNode }));
  const identities: Human['identities'] = [];
  const seam: CollabDocSeam = {
    applyRemoteUpdate: (update, origin) => store.applyRemoteUpdate(update, origin),
    onDocUpdate: (callback) => store.onUpdate(callback),
    onAnyDocUpdate: (callback) => store.onAnyUpdate(callback),
    getStateVector: () => store.getStateVector(),
    encodeStateAsUpdate: (stateVector) => store.encodeStateAsUpdate(stateVector),
    enableAwareness: () => store.enableAwareness(),
    setAwarenessField: (field, value) => store.setAwarenessField(field, value),
    getAwarenessStates: () => store.getAwarenessStates(),
    onAwarenessChange: (callback) => store.onAwarenessChange(callback),
    onAwarenessUpdate: (callback) => store.onAwarenessUpdate(callback),
    encodeAwarenessUpdate: (clients) => store.encodeAwarenessUpdate(clients),
    encodeLocalAwarenessDeparture: () => store.encodeLocalAwarenessDeparture(),
    applyAwarenessUpdate: (update, origin) => store.applyAwarenessUpdate(update, origin),
    clearRemoteAwarenessStates: () => store.clearRemoteAwarenessStates(),
    resetForRelineage: () => store.resetForRelineage(),
  };
  const provider = createCollabProvider({
    url: `${wsUrl}/${DOC}`,
    docId: DOC,
    yjs: seam,
    ticketSource: async () => blokTicket(SECRET, { user: HUMAN, doc: DOC, write: true, ttlSeconds: 600 }),
    socketFactory: nodeSocketFactory(ORIGIN),
    random: () => 0,
    onVerifiedIdentities: (map) => identities.splice(0, identities.length, ...map),
  });

  provider.connect();

  return {
    store,
    provider,
    identities,
    destroy: () => {
      provider.destroy();
      store.destroy();
    },
  };
};

const agentState = (human: Human): Record<string, unknown> | undefined =>
  [...human.store.getAwarenessStates().values()].find((state) => state.agent !== undefined);

const withRoom = async (run: (input: { wsUrl: string; request: (method: string, path: string) => Promise<{ status: number; text: string }> }) => Promise<void>): Promise<void> => {
  const collabDirectory = await mkdtemp(join(tmpdir(), 'blok-mcp-conformance-'));
  const endpoint = await startDocEndpoint();

  try {
    const server = await startServer({
      args: [
        '--listen', '127.0.0.1:0', '--auth', 'ticket', '--storage-dir', '', '--rate-limit', '0',
        '--collab', '--collab-dir', collabDirectory, '--doc-endpoint', endpoint.url,
        '--conformance-journal', '--allow-origin', ORIGIN,
      ],
      env: { BLOK_SECRET: SECRET },
    });

    try {
      await run({
        wsUrl: `${server.baseUrl.replace(/^http:/, 'ws:')}/sync`,
        request: async (method, path) => {
          const answer = await server.request(method, path, {
            headers: { Origin: ORIGIN, Authorization: `Bearer ${blokTicket(SECRET, { user: HUMAN, doc: DOC, write: true })}` },
          });

          return { status: answer.status, text: answer.text };
        },
      });
    } finally {
      await server.stop();
    }
  } finally {
    await endpoint.stop();
    await rm(collabDirectory, { recursive: true, force: true });
  }
};

it('an MCP agent joins as its own participant and writes formatted rich text', async () => {
  await withRoom(async ({ wsUrl, request }) => {
    const human = connectHuman(wsUrl);
    const mcp = mcpFor(wsUrl);

    try {
      await waitFor(() => human.provider.status === 'connected', () => `human status ${human.provider.status}`);
      const opened = await mcp.dispatch('blok_open', { documentId: DOC, write: true }, caller);

      expect(opened.structuredContent).toMatchObject({ mode: 'live', durability: 'acknowledged' });
      const handle = opened.structuredContent.handle;
      const executed = await mcp.dispatch('blok_execute', {
        handle,
        commands: [{ name: 'block.insert', args: { type: 'paragraph', id: 'agent-p', data: { text: [{ text: 'Hello ' }, { text: 'bold', marks: { bold: true } }] } } }],
      }, caller);

      // Durable only after the server acknowledged it.
      expect(executed.structuredContent).toMatchObject({ ok: true, delivery: { durable: true, pending: false, serverSequence: expect.any(String) } });

      await waitFor(() => human.store.getBlockById('agent-p') !== undefined, () => 'the agent block at the human');
      const data = human.store.getBlockById('agent-p')?.get('data');
      const text = data instanceof Y.Map ? data.get('text') : undefined;

      expect(text).toBeInstanceOf(Y.XmlText);
      if (text instanceof Y.XmlText) {
        expect(JSON.stringify(new YBlockSerializer({ htmlToSegments: htmlToSegmentsNode }).readRichText(text))).toContain('"bold":true');
      }

      // Frame 107 names the agent, not the human (participants group by verified id).
      await waitFor(() => human.identities.some((entry) => entry.actorId === AGENT_ID), () => JSON.stringify(human.identities));
      expect(human.identities.some((entry) => entry.actorId === HUMAN)).toBe(true);

      // The human sees agent + agentCursor awareness fields, never a caret.
      await waitFor(() => agentState(human) !== undefined, () => 'agent awareness');
      await waitFor(() => agentState(human)?.agentCursor !== undefined, () => 'agent cursor');
      expect(agentState(human)?.agent).toEqual({ via: 'mcp', onBehalfOf: HUMAN });
      // Browsers compose "<agent> for <person>" (03 §3.10), so the published names carry no "(for …)".
      expect(agentState(human)?.user).toMatchObject({ name: 'claude-code', id: AGENT_ID });
      expect(agentState(human)?.agentCursor).toMatchObject({ actorId: AGENT_ID, name: 'claude-code', blockId: 'agent-p' });
      expect(agentState(human)?.caret).toBeUndefined();

      // Saved attribution and journal actors.
      // Co-authored: the person the agent acts for edits, with the agent.
      expect(human.store.toJSON().find((block) => block.id === 'agent-p')).toMatchObject({ lastEditedBy: HUMAN, lastEditedWith: AGENT_ID });
      const history = await request('GET', `/sync/${DOC}/history`);

      expect(history.status).toBe(200);
      expect(history.text).toContain(AGENT_ID);

      const closed = await mcp.dispatch('blok_close', { handle }, caller);

      expect(closed.structuredContent).toEqual({ closed: true, unsavedBatches: 0, hostRecordLags: true });
      await waitFor(() => agentState(human) === undefined, () => 'agent to leave');
    } finally {
      await mcp.stop();
      human.destroy();
    }
  });
}, 60_000);

it('a moved block keeps its identity while the human types inside it', async () => {
  await withRoom(async ({ wsUrl }) => {
    const human = connectHuman(wsUrl);
    const mcp = mcpFor(wsUrl);

    try {
      await waitFor(() => human.provider.status === 'connected', () => 'human connected');
      const handle = (await mcp.dispatch('blok_open', { documentId: DOC, write: true }, caller)).structuredContent.handle;

      const inserted = await mcp.dispatch('blok_execute', {
        handle,
        commands: [
          { name: 'block.insert', args: { type: 'paragraph', id: 'first', data: { text: 'first' } } },
          { name: 'block.insert', args: { type: 'paragraph', id: 'moved', data: { text: 'move me' } } },
        ],
      }, caller);

      expect(inserted.structuredContent).toMatchObject({ ok: true });
      await waitFor(() => human.store.getBlockById('moved') !== undefined, () => 'moved block at human');
      const before = human.store.getBlockById('moved');

      human.store.transact(() => {
        human.store.updateBlockData('moved', 'text', 'move me, typed');
      }, 'local');
      const moved = await mcp.dispatch('blok_execute', { handle, commands: [{ name: 'block.move', args: { id: 'moved', position: { before: 'first' } } }] }, caller);

      expect(moved.structuredContent).toMatchObject({ ok: true });
      await waitFor(() => human.store.toJSON()[0]?.id === 'moved', () => JSON.stringify(human.store.toJSON().map((block) => block.id)));
      expect(human.store.getBlockById('moved')).toBe(before);
      await waitFor(() => JSON.stringify(human.store.toJSON()[0].data).includes('typed'), () => JSON.stringify(human.store.toJSON()[0].data));
    } finally {
      await mcp.stop();
      human.destroy();
    }
  });
}, 60_000);

it('a read-only ticket makes the batch not saved with READ_ONLY', async () => {
  await withRoom(async ({ wsUrl }) => {
    const mcp = mcpFor(wsUrl);

    try {
      const handle = (await mcp.dispatch('blok_open', { documentId: DOC, write: false }, caller)).structuredContent.handle;
      const outcome = await mcp.dispatch('blok_execute', { handle, commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'x' } } }] }, caller);

      expect(outcome.structuredContent).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
    } finally {
      await mcp.stop();
    }
  });
}, 60_000);

it('a write the room refuses for a read-only ticket is reported not saved, and locks the handle', async () => {
  await withRoom(async ({ wsUrl }) => {
    const ticketHost = await startReadOnlyTicketHost();
    const mcp = mcpFor(wsUrl, { kind: 'url', url: ticketHost.url, hostToken: HOST_TOKEN });

    try {
      const handle = (await mcp.dispatch('blok_open', { documentId: DOC, write: true }, caller)).structuredContent.handle;
      const outcome = await mcp.dispatch('blok_execute', { handle, commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'x' } } }] }, caller);

      expect(outcome.structuredContent).toMatchObject({
        ok: false,
        error: { code: 'READ_ONLY', message: expect.stringContaining('The room refused the write') },
        delivery: { durable: false },
      });
      const again = await mcp.dispatch('blok_execute', { handle, commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'y' } } }] }, caller);

      expect(again.structuredContent).toMatchObject({ ok: false, error: { code: 'READ_ONLY', message: 'This handle cannot write to the room.' } });
    } finally {
      await mcp.stop();
      await ticketHost.close();
    }
  });
}, 60_000);

it('open before sync never returns an empty view', async () => {
  await withRoom(async ({ wsUrl }) => {
    const human = connectHuman(wsUrl);
    const mcp = mcpFor(wsUrl);

    try {
      await waitFor(() => human.provider.status === 'connected', () => 'human connected');
      human.store.transact(() => {
        human.store.addBlock({ id: 'h1', type: 'paragraph', data: { text: 'already here' } });
      }, 'local');
      await new Promise((done) => setTimeout(done, 500));
      const opened = await mcp.dispatch('blok_open', { documentId: DOC, view: {} }, caller);

      expect(JSON.stringify(opened.structuredContent.view)).toContain('h1');
    } finally {
      await mcp.stop();
      human.destroy();
    }
  });
}, 60_000);
