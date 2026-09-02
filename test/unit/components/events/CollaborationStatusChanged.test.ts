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
      peers: [
        {
          clientId: 42,
          user: { name: 'Ada', color: '#ff0000' },
          blockId: 'block-1',
          canWrite: true,
        },
        {
          clientId: 7,
          user: { name: 'Grace', color: '#00ff00' },
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
      peers: [],
      code: 1006,
      reason: 'connection lost',
      retryInMs: 30_000,
    };
    const dead: CollaborationStatusChangedPayload = {
      status: 'error',
      peers: [],
      error: 'forbidden',
      code: 4403,
      reason: 'this user may not open this document',
    };

    dispatcher.emit(CollaborationStatusChanged, retrying);
    dispatcher.emit(CollaborationStatusChanged, dead);

    expect(seen.map((payload) => payload.retryInMs)).toEqual([30_000, undefined]);
    expect(seen.map((payload) => payload.error)).toEqual([undefined, 'forbidden']);
  });
});
