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

  it('accepts every declared connection status', () => {
    const statuses: CollaborationStatusChangedPayload['status'][] = ['connecting', 'connected', 'offline'];

    expect(statuses).toHaveLength(3);
  });
});
