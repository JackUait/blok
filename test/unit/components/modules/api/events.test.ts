import { describe, expect, it, vi } from 'vitest';

import EventsAPI from '../../../../../src/components/modules/api/events';
import EventsDispatcher from '../../../../../src/components/utils/events';
import { BlockChanged } from '../../../../../src/components/events/BlockChanged';

import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { EditorConfig } from '../../../../../types';
import type { EditorEventMap } from '../../../../../src/components/events';
import type { BlockChangedPayload } from '../../../../../src/components/events/BlockChanged';
import type { BlockMutationEvent } from '../../../../../types/events/block';

const createEventsApi = (): {
  eventsApi: EventsAPI;
  eventsDispatcher: EventsDispatcher<EditorEventMap>;
} => {
  const eventsDispatcher = new EventsDispatcher<EditorEventMap>();
  const moduleConfig: ModuleConfig = {
    config: {} as EditorConfig,
    eventsDispatcher,
  };

  return {
    eventsApi: new EventsAPI(moduleConfig),
    eventsDispatcher,
  };
};

describe('EventsAPI', () => {
  const payload: BlockChangedPayload = {
    event: {} as BlockMutationEvent,
  };

  it('exposes emit/on/off wrappers via methods getter', () => {
    const { eventsApi } = createEventsApi();
    const emitSpy = vi.spyOn(eventsApi, 'emit').mockImplementation(() => undefined);
    const onSpy = vi.spyOn(eventsApi, 'on').mockImplementation(() => undefined);
    const offSpy = vi.spyOn(eventsApi, 'off').mockImplementation(() => undefined);
    const handler = vi.fn() as (data?: unknown) => void;

    eventsApi.methods.emit(BlockChanged, payload);
    eventsApi.methods.on(BlockChanged, handler);
    eventsApi.methods.off(BlockChanged, handler);

    expect(emitSpy).toHaveBeenCalledWith(BlockChanged, payload);
    expect(onSpy).toHaveBeenCalledWith(BlockChanged, handler);
    expect(offSpy).toHaveBeenCalledWith(BlockChanged, handler);
  });

  it('subscribes to events via dispatcher on()', () => {
    const { eventsApi, eventsDispatcher } = createEventsApi();
    const dispatcherSpy = vi.spyOn(eventsDispatcher, 'on');
    const handler = vi.fn() as (data?: unknown) => void;

    eventsApi.on(BlockChanged, handler);

    expect(dispatcherSpy).toHaveBeenCalledWith(BlockChanged, handler);
  });

  it('emits events via dispatcher emit()', () => {
    const { eventsApi, eventsDispatcher } = createEventsApi();
    const dispatcherSpy = vi.spyOn(eventsDispatcher, 'emit');

    eventsApi.emit(BlockChanged, payload);

    expect(dispatcherSpy).toHaveBeenCalledWith(BlockChanged, payload);
  });

  it('unsubscribes from events via dispatcher off()', () => {
    const { eventsApi, eventsDispatcher } = createEventsApi();
    const dispatcherSpy = vi.spyOn(eventsDispatcher, 'off');
    const handler = vi.fn() as (data?: unknown) => void;

    eventsApi.off(BlockChanged, handler);

    expect(dispatcherSpy).toHaveBeenCalledWith(BlockChanged, handler);
  });
});
