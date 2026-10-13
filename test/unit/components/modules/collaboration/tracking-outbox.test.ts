// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrackingOutbox } from '../../../../../src/components/modules/collaboration/tracking-outbox';
import type { CollabOutbox, CollabOutboxRow } from '../../../../../src/components/modules/collaboration/types';

const memoryOutbox = (lineage = 'L1'): CollabOutbox & { rows: CollabOutboxRow[] } => {
  let next = 0;
  const rows: CollabOutboxRow[] = [];

  return {
    rows,
    appendLocal: async (bytes) => {
      next += 1;
      const row = { operationId: `op-${next}`, lineage, format: 2, bytes };

      rows.push(row);

      return row;
    },
    oldestPending: async () => rows[0] ?? null,
    acknowledge: async (id) => {
      rows.splice(rows.findIndex((row) => row.operationId === id), 1);
    },
    quarantineLineage: async (target) => {
      const moved = rows.filter((row) => row.lineage === target).length;

      rows.splice(0, rows.length, ...rows.filter((row) => row.lineage !== target));

      return moved;
    },
    onCommitted: () => () => undefined,
  };
};

describe('TrackingOutbox', () => {
  let inner: ReturnType<typeof memoryOutbox>;
  let outbox: TrackingOutbox;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    inner = memoryOutbox();
    outbox = new TrackingOutbox(inner);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('delegates appends and remembers the order', async () => {
    const mark = outbox.appendedCount();

    await outbox.appendLocal(new Uint8Array([1]));
    await outbox.appendLocal(new Uint8Array([2]));

    expect(inner.rows).toHaveLength(2);
    expect(outbox.idsSince(mark)).toEqual(['op-1', 'op-2']);
    expect(outbox.pendingIds()).toEqual(['op-1', 'op-2']);
  });

  it('resolves acked with the sequence noted just before the ack', async () => {
    await outbox.appendLocal(new Uint8Array([1]));
    await outbox.appendLocal(new Uint8Array([2]));
    const waiting = outbox.waitFor(['op-1', 'op-2'], 10_000);

    outbox.noteSequence('41');
    await outbox.acknowledge('op-1');
    outbox.noteSequence('42');
    await outbox.acknowledge('op-2');

    expect(await waiting).toEqual({ state: 'acked', serverSequence: '42' });
    expect(outbox.pendingIds()).toEqual([]);
  });

  it('resolves quarantined with the reason when any row is moved aside', async () => {
    await outbox.appendLocal(new Uint8Array([1]));
    const waiting = outbox.waitFor(['op-1'], 10_000);

    await outbox.quarantineLineage('L1', 'read-only', new Uint8Array(0));

    expect(await waiting).toEqual({ state: 'quarantined', reason: 'read-only' });
  });

  it('keeps rows a keepFormat filter keeps', async () => {
    await outbox.appendLocal(new Uint8Array([1]));
    await outbox.quarantineLineage('L1', 'stale-format', new Uint8Array(0), { keepFormat: 2 });

    expect(outbox.pendingIds()).toEqual(['op-1']);
  });

  it('only touches rows of the quarantined lineage', async () => {
    await outbox.appendLocal(new Uint8Array([1]));
    await outbox.quarantineLineage('OTHER', 'lineage-reset', new Uint8Array(0));

    expect(outbox.pendingIds()).toEqual(['op-1']);
  });

  it('times out without inventing an ack', async () => {
    vi.useFakeTimers();
    await outbox.appendLocal(new Uint8Array([1]));
    const waiting = outbox.waitFor(['op-1'], 10_000);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(await waiting).toEqual({ state: 'timeout' });
  });

  it('treats an empty batch as acked with no sequence', async () => {
    expect(await outbox.waitFor([], 10_000)).toEqual({ state: 'acked', serverSequence: null });
  });

  it('answers at once for rows already settled', async () => {
    await outbox.appendLocal(new Uint8Array([1]));
    outbox.noteSequence('7');
    await outbox.acknowledge('op-1');

    expect(await outbox.waitFor(['op-1'], 10_000)).toEqual({ state: 'acked', serverSequence: '7' });
  });

  it('calls a row acked only after its ack, never after a quarantine', async () => {
    const acked = await outbox.appendLocal(new Uint8Array([1]));

    expect(outbox.isAcked(acked.operationId)).toBe(false);
    await outbox.acknowledge(acked.operationId);
    expect(outbox.isAcked(acked.operationId)).toBe(true);

    const refused = await outbox.appendLocal(new Uint8Array([2]));

    await outbox.quarantineLineage('L1', 'lineage-reset', new Uint8Array(0));
    expect(outbox.pendingIds()).toEqual([]);
    expect(outbox.isAcked(refused.operationId)).toBe(false);
    expect(outbox.isAcked('never-appended')).toBe(false);
  });

  it('drops a wait, its timer and its listener once its signal aborts', async () => {
    vi.useFakeTimers();
    try {
      const row = await outbox.appendLocal(new Uint8Array([1]));
      const controller = new AbortController();
      const wait = outbox.waitFor([row.operationId], 10_000, controller.signal);

      expect(vi.getTimerCount()).toBe(1);
      controller.abort();
      await wait;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
