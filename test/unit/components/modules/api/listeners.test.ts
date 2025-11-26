import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

import ListenersAPI from '../../../../../src/components/modules/api/listeners';
import EventsDispatcher from '../../../../../src/components/utils/events';

import type { EditorEventMap } from '../../../../../src/components/events';
import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { EditorConfig } from '../../../../../types';

type ListenersMock = {
  on: Mock<(element: HTMLElement, eventType: string, handler: () => void, useCapture?: boolean) => string | undefined>;
  off: Mock<(element: Element, eventType: string, handler: () => void, useCapture?: boolean) => void>;
  offById: Mock<(id: string) => void>;
};

const createListenersApi = (): ListenersAPI => {
  const eventsDispatcher = new EventsDispatcher<EditorEventMap>();
  const moduleConfig: ModuleConfig = {
    config: {} as EditorConfig,
    eventsDispatcher,
  };

  return new ListenersAPI(moduleConfig);
};

describe('ListenersAPI', () => {
  let listenersApi: ListenersAPI;
  let listenersMock: ListenersMock;

  beforeEach(() => {
    listenersApi = createListenersApi();

    listenersMock = {
      on: vi.fn(),
      off: vi.fn(),
      offById: vi.fn(),
    };

    (listenersApi as unknown as { listeners: ListenersMock }).listeners = listenersMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes bound methods via the methods getter', () => {
    const onSpy = vi.spyOn(listenersApi, 'on');
    const offSpy = vi.spyOn(listenersApi, 'off');
    const offByIdSpy = vi.spyOn(listenersApi, 'offById');
    const methods = listenersApi.methods;
    const element = document.createElement('div');
    const handler = vi.fn();

    methods.on(element, 'click', handler, true);
    methods.off(element, 'click', handler, false);
    methods.offById('listener-id');

    expect(onSpy).toHaveBeenCalledWith(element, 'click', handler, true);
    expect(offSpy).toHaveBeenCalledWith(element, 'click', handler, false);
    expect(offByIdSpy).toHaveBeenCalledWith('listener-id');
  });

  it('registers DOM listeners via the listeners utility', () => {
    const element = document.createElement('div');
    const handler = vi.fn();

    listenersMock.on.mockReturnValueOnce('listener-id');

    const id = listenersApi.on(element, 'scroll', handler, true);

    expect(listenersMock.on).toHaveBeenCalledWith(element, 'scroll', handler, true);
    expect(id).toBe('listener-id');
  });

  it('removes DOM listeners via the listeners utility', () => {
    const element = document.createElement('div');
    const handler = vi.fn();

    listenersApi.off(element, 'keydown', handler, false);

    expect(listenersMock.off).toHaveBeenCalledWith(element, 'keydown', handler, false);
  });

  it('removes DOM listeners by id via the listeners utility', () => {
    listenersApi.offById('listener-id');

    expect(listenersMock.offById).toHaveBeenCalledWith('listener-id');
  });
});
