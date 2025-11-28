import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { BlockSettingsClosed, type BlockSettingsClosedPayload } from '../../../../src/components/events/BlockSettingsClosed';
import type { BlokEventMap } from '../../../../src/components/events';
import EventsDispatcher from '../../../../src/components/utils/events';

describe('BlockSettingsClosed event', () => {
  it('uses stable event name', () => {
    expect(BlockSettingsClosed).toBe('block-settings-closed');
  });

  it('does not require payload data', () => {
    const acceptsPayload = (payload: BlockSettingsClosedPayload): BlockSettingsClosedPayload => payload;
    const payload: BlockSettingsClosedPayload = {};

    expect(acceptsPayload(payload)).toEqual({});
  });

  it('is registered in BlokEventMap with matching payload', () => {
    expectTypeOf<BlokEventMap[typeof BlockSettingsClosed]>().toEqualTypeOf<BlockSettingsClosedPayload>();
  });

  it('can be emitted through EventsDispatcher without payload', () => {
    const dispatcher = new EventsDispatcher<BlokEventMap>();
    const handler = vi.fn();

    dispatcher.on(BlockSettingsClosed, handler);
    dispatcher.emit(BlockSettingsClosed);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(undefined);
  });
});
