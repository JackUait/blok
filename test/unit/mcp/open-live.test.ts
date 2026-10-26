// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decode, encode } from '../../../src/components/modules/collaboration/sync-wire';
import type { CollabSocketFactory, SyncWireFrame, WebSocketLike, WorkingSetTag } from '../../../src/components/modules/collaboration/types';
import { defaultAgentActor } from '../../../src/mcp/actor';
import { buildMcpContracts } from '../../../src/mcp/contract';
import type { Caller, OpenRequest } from '../../../src/mcp/dispatcher';
import { createOpenLive, syncUrlFor } from '../../../src/mcp/live/open-live';
import { surfaceError } from '../../../src/mcp/errors';
import type { HandleSession } from '../../../src/mcp/session';
import { createHeadlessPorts } from '../../../src/view/agent-runtime';

const TAG: WorkingSetTag = { format: 2, epoch: 0, lineage: '0123456789abcdef0123456789abcdef' };
const caller: Caller = { principal: 'alice', clientName: 'claude', scopes: null };
const actor = defaultAgentActor('alice', 'claude');
const contracts = buildMcpContracts({ pageTitles: 'off' });

type Script = 'sync' | 'silent' | 'forbidden';

class ScriptedSocket implements WebSocketLike {
  public binaryType = 'blob';
  public readyState = 0;
  public protocol = '';
  public sent: SyncWireFrame[] = [];
  public onopen: ((event: unknown) => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onclose: ((event: { code: number; reason: string }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;

  public send(data: ArrayBufferLike | ArrayBufferView): void {
    const bytes = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
    const frame = decode(bytes);

    if (frame.type !== 'unknown' && frame.type !== 'malformed') {
      this.sent.push(frame);
    }
  }

  public close(): void {
    this.readyState = 3;
  }

  public deliver(frame: SyncWireFrame): void {
    this.onmessage?.({ data: encode(frame).slice().buffer });
  }
}

describe('createOpenLive', () => {
  let sockets: ScriptedSocket[];
  let urls: string[];
  let script: Script;
  const sessions: HandleSession[] = [];

  const factory: CollabSocketFactory = (url) => {
    const socket = new ScriptedSocket();

    urls.push(url);
    sockets.push(socket);
    queueMicrotask(() => {
      socket.readyState = 1;
      socket.protocol = 'blok-sync.v2';
      socket.onopen?.({});
      if (script === 'forbidden') {
        socket.readyState = 3;
        socket.onclose?.({ code: 4403, reason: 'forbidden' });

        return;
      }
      if (script === 'sync') {
        socket.deliver({ type: 'control', tag: TAG });
        socket.deliver({ type: 'syncStep2', update: new Uint8Array([0, 0]) });
      }
    });

    return socket;
  };

  const openLive = createOpenLive({
    sync: { url: 'wss://sync.test/sync/' },
    contracts,
    socketFactory: factory,
    syncTimeoutMs: 100,
    portsFor: () => createHeadlessPorts({
      sanitizeFor: (type) => contracts.runtimes.get(type)?.sanitize,
      richTextFieldsFor: contracts.richTextFieldsFor,
    }),
  });

  const open = async (request: Partial<OpenRequest> = {}): Promise<HandleSession> => {
    const session = await openLive({ documentId: 'doc', mode: 'auto', write: true, ...request }, caller, actor);

    sessions.push(session);

    return session;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sockets = [];
    urls = [];
    script = 'sync';
  });

  afterEach(async () => {
    await Promise.all(sessions.splice(0).map((session) => session.close('closed')));
    vi.restoreAllMocks();
  });

  it('opens a live, acknowledged handle once the room synced', async () => {
    const session = await open();

    expect(session).toMatchObject({ mode: 'live', write: true, durability: 'acknowledged', contractRevision: contracts.live.revision });
  });

  it('answers ROOM_SYNC_TIMEOUT when the room never syncs', async () => {
    script = 'silent';

    await expect(open()).rejects.toMatchObject({ agentError: { code: 'ROOM_SYNC_TIMEOUT', retryable: true } });
    expect(sockets[0].readyState).toBe(3);
  });

  it('maps a refusal before sync to FORBIDDEN', async () => {
    script = 'forbidden';

    await expect(open()).rejects.toMatchObject({ agentError: { code: 'FORBIDDEN' } });
  });

  it('publishes the agent participant, then withdraws it on close', async () => {
    const session = await open();

    // The provider batches awareness in a 100 ms window.
    await vi.waitFor(() => expect(sockets[0].sent.some((frame) => frame.type === 'awareness')).toBe(true));
    const awarenessBefore = sockets[0].sent.filter((frame) => frame.type === 'awareness').length;

    await session.close('closed');
    sessions.splice(sessions.indexOf(session), 1);

    expect(sockets[0].readyState).toBe(3);
    expect(sockets[0].sent.filter((frame) => frame.type === 'awareness').length).toBeGreaterThan(awarenessBefore);
  });

  it('answers NOTHING_TO_UNDO on a live handle that has not written', async () => {
    const session = await open();
    const outcome = await session.execute({ commands: [{ name: 'history.undo', args: {} }] });

    expect(outcome).toMatchObject({ ok: false, error: { code: 'NOTHING_TO_UNDO' } });
  });

  it('closes the room when building the session fails after the sync', async () => {
    const failing = createOpenLive({
      sync: { url: 'wss://sync.test/sync/' },
      contracts,
      socketFactory: factory,
      syncTimeoutMs: 100,
      portsFor: () => {
        throw new Error('no ports');
      },
    });

    await expect(failing({ documentId: 'doc', mode: 'auto', write: true }, caller, actor)).rejects.toThrow('no ports');
    expect(sockets[0].readyState).toBe(3);
  });

  it('answers FORBIDDEN, not a retryable sync timeout, when the room\'s first ticket is refused', async () => {
    const refusing = createOpenLive({
      sync: { url: 'wss://sync.test/sync/' },
      contracts,
      socketFactory: factory,
      syncTimeoutMs: 100,
      ticketsFor: async () => async () => {
        throw surfaceError('FORBIDDEN', 'The host did not grant this document to this agent.');
      },
      portsFor: () => createHeadlessPorts({
        sanitizeFor: (type) => contracts.runtimes.get(type)?.sanitize,
        richTextFieldsFor: contracts.richTextFieldsFor,
      }),
    });

    await expect(refusing({ documentId: 'doc', mode: 'auto', write: true }, caller, actor))
      .rejects.toMatchObject({ agentError: { code: 'FORBIDDEN' } });
  });

  it('answers FORBIDDEN at once, without waiting out the sync timeout, when the first ticket is refused', async () => {
    const refusing = createOpenLive({
      sync: { url: 'wss://sync.test/sync/' },
      contracts,
      socketFactory: factory,
      syncTimeoutMs: 10_000,
      ticketsFor: async () => async () => {
        throw surfaceError('FORBIDDEN', 'The host did not grant this document to this agent.');
      },
      portsFor: () => createHeadlessPorts({
        sanitizeFor: (type) => contracts.runtimes.get(type)?.sanitize,
        richTextFieldsFor: contracts.richTextFieldsFor,
      }),
    });
    const started = Date.now();
    const failure = await refusing({ documentId: 'doc', mode: 'auto', write: true }, caller, actor).then(() => null, (thrown: unknown) => thrown);

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(failure).toMatchObject({ agentError: { code: 'FORBIDDEN' } });
  }, 15_000);

  it('ends the handle with FORBIDDEN once the ticket endpoint refuses a reconnect', async () => {
    const mints = { count: 0 };
    const revoking = createOpenLive({
      sync: { url: 'wss://sync.test/sync/' },
      contracts,
      socketFactory: factory,
      syncTimeoutMs: 100,
      ticketsFor: async () => async () => {
        mints.count += 1;
        if (mints.count > 1) {
          throw surfaceError('FORBIDDEN', 'The host did not grant this document to this agent.');
        }

        return 'ticket-1';
      },
      portsFor: () => createHeadlessPorts({
        sanitizeFor: (type) => contracts.runtimes.get(type)?.sanitize,
        richTextFieldsFor: contracts.richTextFieldsFor,
      }),
    });
    const session = await revoking({ documentId: 'doc', mode: 'auto', write: true }, caller, actor);

    sessions.push(session);
    vi.useFakeTimers();
    try {
      sockets[0].readyState = 3;
      sockets[0].onclose?.({ code: 1006, reason: 'dropped' });
      await vi.advanceTimersByTimeAsync(120_000);
      const callsAfterRevocation = mints.count;

      const write = session.execute({ commands: [{ name: 'doc.setTitle', args: { title: 'x' } }] });

      await vi.advanceTimersByTimeAsync(120_000);
      expect({ outcome: await write, mintsAfterMore: mints.count }).toMatchObject({
        outcome: { ok: false, error: { code: 'FORBIDDEN' } },
        mintsAfterMore: callsAfterRevocation,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('percent-encodes the document id into the sync URL', async () => {
    await open({ documentId: 'a/b c' });

    expect(urls[0]).toBe('wss://sync.test/sync/a%2Fb%20c');
    expect(syncUrlFor('wss://h/sync', 'x')).toBe('wss://h/sync/x');
  });

  it.each(['.', '..'])('refuses document id %j, which a URL resolves as a path step', (documentId) => {
    expect(() => syncUrlFor('wss://h/sync', documentId)).toThrow(expect.objectContaining({ agentError: expect.objectContaining({ code: 'INVALID_ARGS' }) }));
  });
});
