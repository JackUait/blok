// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeadlessRoom, HeadlessRoomEnd } from '../../../src/components/modules/collaboration/headless-session';
import { TrackingOutbox } from '../../../src/components/modules/collaboration/tracking-outbox';
import type { CollabOutbox, CollabOutboxRow, CollabTerminalError } from '../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';
import { buildMcpContracts } from '../../../src/mcp/contract';
import { createLiveSession, terminalToError, type PresenceSink } from '../../../src/mcp/live/live-session';
import { htmlToSegmentsNode } from '../../../src/view/rich-text-node';
import type { AgentResult, AgentSession } from '../../../types/agent';

const contract = buildMcpContracts({ pageTitles: 'off' }).live;

const ok: AgentResult = { ok: true, revision: '5', results: [], refs: {}, changed: { created: ['p1'], updated: [], moved: [], removed: [] }, warnings: [] };

const innerOutbox = (): CollabOutbox => {
  let n = 0;

  return {
    appendLocal: async (bytes): Promise<CollabOutboxRow> => {
      n += 1;

      return { operationId: `op-${n}`, lineage: 'L1', format: 2, bytes };
    },
    oldestPending: async () => null,
    acknowledge: async () => undefined,
    quarantineLineage: async () => 1,
    onCommitted: () => () => undefined,
  };
};

const TERMINAL_CASES: Array<[CollabTerminalError, string]> = [
  ['unsupported-format', 'VERSION_SKEW'],
  ['forbidden', 'FORBIDDEN'],
  ['unauthorized', 'FORBIDDEN'],
  ['apply-failed', 'SOURCE_UNAVAILABLE'],
];

describe('createLiveSession', () => {
  let outbox: TrackingOutbox;
  let endListeners: Array<(end: HeadlessRoomEnd) => void>;
  let ended: HeadlessRoomEnd | null;
  let protocol: 'v1' | 'v2';
  let failures: number;
  let store: DocumentStore;
  let room: HeadlessRoom;
  const presence = {
    announce: vi.fn<PresenceSink['announce']>(),
    afterBatch: vi.fn<PresenceSink['afterBatch']>(),
    clear: vi.fn<PresenceSink['clear']>(),
  };
  const roomClose = vi.fn<HeadlessRoom['close']>();
  const agentExecute = vi.fn<AgentSession['execute']>();
  const agentRead = vi.fn<AgentSession['read']>();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    outbox = new TrackingOutbox(innerOutbox());
    endListeners = [];
    ended = null;
    protocol = 'v2';
    failures = 0;
    store = new DocumentStore(new YBlockSerializer({ htmlToSegments: htmlToSegmentsNode }));
    roomClose.mockResolvedValue(undefined);
    room = {
      store,
      outbox,
      get protocol() {
        return protocol;
      },
      sendActivity: () => true,
      flushAppends: async () => undefined,
      appendFailures: () => failures,
      ended: () => ended,
      onEnd: (listener) => {
        endListeners.push(listener);

        return () => {
          endListeners = endListeners.filter((entry) => entry !== listener);
        };
      },
      close: roomClose,
    };
    // The agent's write makes the tap append one row, as the real store + tap would.
    agentExecute.mockImplementation(async () => {
      await outbox.appendLocal(new Uint8Array([1]));

      return ok;
    });
    agentRead.mockResolvedValue({ revision: '5', rootId: null, blocks: [] });
  });

  afterEach(() => {
    store.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const session = (write = true, ackTimeoutMs = 10_000): ReturnType<typeof createLiveSession> => createLiveSession({
    room,
    agent: {
      id: 's',
      actor: { id: 'agent:a', name: 'a', kind: 'agent' },
      read: agentRead,
      describe: () => contract,
      execute: agentExecute,
      log: () => [],
      close: () => undefined,
    },
    contract,
    presence,
    write,
    ackTimeoutMs,
  });

  const insert = { commands: [{ name: 'block.insert' as const, args: {} }] };
  const end = (value: HeadlessRoomEnd): void => {
    ended = value;
    endListeners.forEach((listener) => listener(value));
  };

  it('reports durable only after the server acks the batch rows', async () => {
    const live = session();
    const pending = live.execute(insert);

    await vi.waitFor(() => expect(outbox.pendingIds()).toEqual(['op-1']));
    outbox.noteSequence('12');
    await outbox.acknowledge('op-1');

    expect(await pending).toMatchObject({ ok: true, delivery: { durable: true, pending: false, serverSequence: '12', savedVersion: null } });
    expect(presence.afterBatch).toHaveBeenCalledWith(ok);
  });

  it('reports pending, not an error, when the ack wait times out', async () => {
    vi.useFakeTimers();
    const live = session();
    const pending = live.execute(insert);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toMatchObject({ ok: true, delivery: { durable: false, pending: true } });
    expect(await live.close('closed')).toEqual({ unsavedBatches: 1, hostRecordLags: true });
  });

  it('stops counting a timed-out batch once its ack arrives later', async () => {
    vi.useFakeTimers();
    const live = session();
    const pending = live.execute(insert);

    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    await outbox.acknowledge('op-1');
    expect(await live.close('closed')).toMatchObject({ unsavedBatches: 0 });
  });

  it('still counts a timed-out batch the room later refused', async () => {
    vi.useFakeTimers();
    const live = session();
    const pending = live.execute(insert);

    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    await outbox.quarantineLineage('L1', 'oversized-update', new Uint8Array(0));
    expect(await live.close('closed')).toMatchObject({ unsavedBatches: 1 });
  });

  it('answers a room end that lands during the ack wait at once, without a pending success', async () => {
    vi.useFakeTimers();
    const live = session();
    const pending = live.execute(insert);

    await vi.waitFor(() => expect(outbox.pendingIds()).toEqual(['op-1']));
    end({ reason: 'terminal', error: 'forbidden' });

    expect(await pending).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' }, delivery: { durable: false, pending: false } });
    expect(endListeners).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(await live.close('closed')).toMatchObject({ unsavedBatches: 1 });
  });

  it('answers a room end that landed before the ack wait began', async () => {
    agentExecute.mockImplementationOnce(async () => {
      await outbox.appendLocal(new Uint8Array([1]));
      end({ reason: 'terminal', error: 'forbidden' });

      return ok;
    });
    const live = session();

    expect(await live.execute(insert)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(endListeners).toEqual([]);
  });

  it('leaves no end listener behind after acked, refused and timed-out batches', async () => {
    vi.useFakeTimers();
    const live = session();
    const acked = live.execute(insert);

    await vi.waitFor(() => expect(outbox.pendingIds()).toEqual(['op-1']));
    await outbox.acknowledge('op-1');
    await acked;
    const refused = live.execute(insert);

    await vi.waitFor(() => expect(outbox.pendingIds()).toEqual(['op-2']));
    await outbox.quarantineLineage('L1', 'oversized-update', new Uint8Array(0));
    await refused;
    const timedOut = live.execute(insert);

    await vi.advanceTimersByTimeAsync(10_000);
    await timedOut;
    expect(endListeners).toEqual([]);
  });

  it('never reports durable when the tap could not journal the batch', async () => {
    agentExecute.mockImplementationOnce(async () => {
      failures += 1;

      return ok;
    });
    const live = session();

    expect(await live.execute(insert)).toMatchObject({ ok: false, error: { code: 'APPLY_FAILED' }, delivery: { durable: false, pending: false } });
    expect(await live.execute(insert)).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
  });

  it('is best-effort under v1', async () => {
    protocol = 'v1';
    agentExecute.mockResolvedValueOnce(ok);
    const live = session();

    expect(live.durability).toBe('best-effort');
    expect(await live.execute(insert)).toMatchObject({ ok: true, delivery: { durable: false, pending: false } });
  });

  it('maps a read-only quarantine to READ_ONLY and locks the handle', async () => {
    const live = session();
    const pending = live.execute(insert);

    await vi.waitFor(() => expect(outbox.pendingIds()).toHaveLength(1));
    await outbox.quarantineLineage('L1', 'read-only', new Uint8Array(0));

    expect(await pending).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
    expect(await live.execute(insert)).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
  });

  it('maps another rejection code to REJECTED and stays usable', async () => {
    const live = session();
    const pending = live.execute(insert);

    await vi.waitFor(() => expect(outbox.pendingIds()).toHaveLength(1));
    await outbox.quarantineLineage('L1', 'oversized-update', new Uint8Array(0));

    expect(await pending).toMatchObject({ ok: false, error: { code: 'REJECTED', details: { rejectionCode: 'oversized-update' } } });
    agentExecute.mockResolvedValueOnce(ok);
    protocol = 'v1';
    expect(await live.execute(insert)).toMatchObject({ ok: true });
  });

  it('maps a lineage-reset quarantine to ROOM_RESET', async () => {
    const live = session();
    const pending = live.execute(insert);

    await vi.waitFor(() => expect(outbox.pendingIds()).toHaveLength(1));
    await outbox.quarantineLineage('L1', 'lineage-reset', new Uint8Array(0));

    expect(await pending).toMatchObject({ ok: false, error: { code: 'ROOM_RESET', details: { notSavedBatches: [1] } } });
    expect(await live.close('closed')).toMatchObject({ unsavedBatches: 1 });
  });

  it('maps a reset to ROOM_RESET listing batches that were never acked, then stays dead', async () => {
    vi.useFakeTimers();
    const live = session();
    const first = live.execute(insert);

    await vi.advanceTimersByTimeAsync(10_000);
    await first;
    // The provider's order: quarantine the old lineage, then finish with 'reset'.
    await outbox.quarantineLineage('L1', 'lineage-reset', new Uint8Array(0));
    end({ reason: 'reset' });

    expect(await live.execute(insert)).toMatchObject({ ok: false, error: { code: 'ROOM_RESET', details: { notSavedBatches: [1] } } });
    await expect(live.read({})).rejects.toMatchObject({ agentError: { code: 'ROOM_RESET' } });
  });

  it.each(TERMINAL_CASES)('maps terminal %s to %s', async (error, code) => {
    const live = session();

    end({ reason: 'terminal', error });
    expect(await live.execute(insert)).toMatchObject({ ok: false, error: { code } });
    expect(terminalToError(error).code).toBe(code);
  });

  it('locks the handle after APPLY_FAILED', async () => {
    agentExecute.mockResolvedValueOnce({ ok: false, revision: '5', error: { code: 'APPLY_FAILED', message: 'partly applied', retryable: false }, warnings: [] });
    const live = session();

    expect(await live.execute(insert)).toMatchObject({ ok: false, error: { code: 'APPLY_FAILED' }, delivery: { durable: false } });
    expect(await live.execute(insert)).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
  });

  it('refuses writes on a read-only handle and still runs reads', async () => {
    agentExecute.mockResolvedValueOnce(ok);
    const live = session(false);

    expect(await live.execute(insert)).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
    expect(agentExecute).not.toHaveBeenCalled();
    expect(await live.execute({ commands: [{ name: 'doc.read', args: {} }] })).toMatchObject({ ok: true });
  });

  it.each([
    ['commands is not an array', { commands: 5 }],
    ['an entry is null', { commands: [null, { args: {} }] }],
  ])('hands a malformed batch to core when %s, instead of throwing', async (_label, batch) => {
    const refusal = { ok: false as const, error: { code: 'INVALID_ARGS' as const, message: 'core', retryable: false }, warnings: [] };

    agentExecute.mockResolvedValueOnce(refusal);
    const live = session(false);

    expect(await live.execute(batch as never)).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS', message: 'core' } });
  });

  it('announces presence on open, clears it and closes the room on close', async () => {
    const live = session();

    expect(presence.announce).toHaveBeenCalledTimes(1);
    await live.close('expired');
    expect(presence.clear).toHaveBeenCalled();
    expect(roomClose).toHaveBeenCalled();
  });
});
