import { describe, it, expect, vi } from 'vitest';

import { CollaborationStatusChanged } from '../../../../src/components/events/CollaborationStatusChanged';
import type { CollaborationStatusChangedPayload } from '../../../../src/components/events/CollaborationStatusChanged';
import type { BlokEventMap } from '../../../../src/components/events';
import { EventsDispatcher } from '../../../../src/components/utils/events';

describe('CollaborationStatusChanged event', () => {
  it('exposes the stable public event name a host subscribes to', () => {
    expect(CollaborationStatusChanged).toBe('collaboration:status');
  });

  it('delivers a fully-typed collaboration status payload through EventsDispatcher listeners', () => {
    const dispatcher = new EventsDispatcher<BlokEventMap>();
    const listener = vi.fn();

    dispatcher.on(CollaborationStatusChanged, listener);

    const payload: CollaborationStatusChangedPayload = {
      status: 'connected',
      participants: [
        {
          userId: 'u_42',
          present: true,
          self: true,
          clientIds: [42],
          lastActiveAt: 1_700_000_000_000,
          user: { name: 'Ada', color: '#ff0000', glyph: null, label: null },
          blockId: 'block-1',
        },
        {
          userId: null,
          present: true,
          self: false,
          clientIds: [7],
          lastActiveAt: null,
          user: { name: 'Grace', color: '#00ff00', glyph: null, label: null },
          blockId: null,
        },
      ],
    };

    dispatcher.emit(CollaborationStatusChanged, payload);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(payload);
  });

  // A host has to tell "retrying in 30s" from "dead, recreate the editor": the
  // first keeps local edits pending, the second never reconnects on its own.
  it('tells a retrying session apart from one that stopped for good', () => {
    const dispatcher = new EventsDispatcher<BlokEventMap>();
    const seen: CollaborationStatusChangedPayload[] = [];

    dispatcher.on(CollaborationStatusChanged, (payload) => seen.push(payload));

    const retrying: CollaborationStatusChangedPayload = {
      status: 'offline',
      participants: [],
      code: 1006,
      reason: 'connection lost',
      retryInMs: 30_000,
    };
    const dead: CollaborationStatusChangedPayload = {
      status: 'error',
      participants: [],
      error: 'forbidden',
      code: 4403,
      reason: 'this user may not open this document',
    };

    dispatcher.emit(CollaborationStatusChanged, retrying);
    dispatcher.emit(CollaborationStatusChanged, dead);

    expect(seen.map((payload) => payload.retryInMs)).toEqual([30_000, undefined]);
    expect(seen.map((payload) => payload.error)).toEqual([undefined, 'forbidden']);
  });

  // Save state is independent of connection state: a live session can still be
  // holding work a reload would lose, so a host reads `save`, never `status`,
  // to decide whether the tab is safe to close.
  it('carries a save state a connected session can still report pending work in', () => {
    const dispatcher = new EventsDispatcher<BlokEventMap>();
    const seen: CollaborationStatusChangedPayload[] = [];

    dispatcher.on(CollaborationStatusChanged, (payload) => seen.push(payload));

    const pending: CollaborationStatusChangedPayload = {
      status: 'connected',
      participants: [],
      save: {
        state: 'pending',
        pendingOperations: 2,
        pendingBytes: 96,
        quarantinedOperations: 0,
      },
    };
    // 2^64 - 1. A `number` rounds it to 18446744073709552000, so the field is a
    // decimal string and has to reach the listener as one.
    const saved: CollaborationStatusChangedPayload = {
      status: 'connected',
      participants: [],
      save: {
        state: 'saved',
        pendingOperations: 0,
        pendingBytes: 0,
        quarantinedOperations: 0,
        serverSequence: '18446744073709551615',
      },
    };

    dispatcher.emit(CollaborationStatusChanged, pending);
    dispatcher.emit(CollaborationStatusChanged, saved);

    expect(seen.map((payload) => payload.save?.state)).toEqual(['pending', 'saved']);
    expect(seen[1].save?.serverSequence).toBe('18446744073709551615');
  });

  // The terminal union is the "will not reconnect" contract. A broken local
  // store or a refused edit does not stop the socket, so those reasons live in
  // `save.reason` and never widen `error`.
  it('keeps persistence reasons out of the terminal reason union', () => {
    const dispatcher = new EventsDispatcher<BlokEventMap>();
    const seen: CollaborationStatusChangedPayload[] = [];

    dispatcher.on(CollaborationStatusChanged, (payload) => seen.push(payload));

    const broken: CollaborationStatusChangedPayload = {
      status: 'connected',
      participants: [],
      save: {
        state: 'blocked',
        reason: 'local-storage-failed',
        pendingOperations: 1,
        pendingBytes: 12,
        quarantinedOperations: 0,
      },
    };

    dispatcher.emit(CollaborationStatusChanged, broken);

    expect(seen[0].error, 'a persistence failure was published as a terminal connection reason').toBeUndefined();
    expect(seen[0].save?.reason).toBe('local-storage-failed');
    expect(seen[0].status).toBe('connected');
  });
});
