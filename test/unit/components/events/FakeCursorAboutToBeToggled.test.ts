import { describe, it, expect, vi } from 'vitest';

import { FakeCursorAboutToBeToggled } from '../../../../src/components/events/FakeCursorAboutToBeToggled';
import type { FakeCursorAboutToBeToggledPayload } from '../../../../src/components/events/FakeCursorAboutToBeToggled';
import type { BlokEventMap } from '../../../../src/components/events';
import { EventsDispatcher } from '../../../../src/components/utils/events';

describe('FakeCursorAboutToBeToggled event', () => {
  it('exposes the stable event name used across the blok', () => {
    expect(FakeCursorAboutToBeToggled).toBe('fake cursor is about to be toggled');
  });

  it('delivers payloads through EventsDispatcher listeners', () => {
    const dispatcher = new EventsDispatcher<BlokEventMap>();
    const listener = vi.fn();

    dispatcher.on(FakeCursorAboutToBeToggled, listener);

    const payload: FakeCursorAboutToBeToggledPayload = { state: true };

    dispatcher.emit(FakeCursorAboutToBeToggled, payload);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(payload);
  });
});
