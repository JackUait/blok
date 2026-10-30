import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Listeners, type ListenerData } from '../../../src/components/utils/listeners';
import * as Utils from '../../../src/components/utils';

const getStoredListeners = (instance: Listeners): ListenerData[] => {
  return Array.from((instance as unknown as { allListeners: Map<string, ListenerData> }).allListeners.values());
};

describe('Listeners', () => {
  let listeners: Listeners;
  let element: HTMLDivElement;

  beforeEach(() => {
    listeners = new Listeners();
    element = document.createElement('div');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers a listener and returns generated id', () => {
    const generateIdSpy = vi.spyOn(Utils, 'generateId').mockReturnValue('l-test');
    const addEventListenerSpy = vi.spyOn(element, 'addEventListener');
    const handler = vi.fn<(event: Event) => void>();

    const id = listeners.on(element, 'click', handler);

    expect(generateIdSpy).toHaveBeenCalledWith('l');
    expect(id).toBe('l-test');
    expect(addEventListenerSpy).toHaveBeenCalledTimes(1);
    expect(addEventListenerSpy).toHaveBeenCalledWith('click', handler, false);

    const storedListeners = getStoredListeners(listeners);

    expect(storedListeners).toHaveLength(1);
    const [ stored ] = storedListeners;

    expect(stored.id).toBe('l-test');
    expect(stored.element).toBe(element);
    expect(stored.eventType).toBe('click');
    expect(stored.handler).toBe(handler);
    expect(stored.options).toBe(false);
  });

  it('does not register duplicate listeners for the same element, event and handler', () => {
    vi.spyOn(Utils, 'generateId')
      .mockReturnValueOnce('first-id')
      .mockReturnValueOnce('second-id');
    const addEventListenerSpy = vi.spyOn(element, 'addEventListener');
    const handler = vi.fn<(event: Event) => void>();

    const firstId = listeners.on(element, 'click', handler);
    const secondId = listeners.on(element, 'click', handler);

    expect(firstId).toBe('first-id');
    expect(secondId).toBeUndefined();
    expect(addEventListenerSpy).toHaveBeenCalledTimes(1);
    expect(getStoredListeners(listeners)).toHaveLength(1);
  });

  it('removes a specific listener with matching handler and event type', () => {
    vi.spyOn(Utils, 'generateId').mockReturnValue('listener-id');
    const addEventListenerSpy = vi.spyOn(element, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(element, 'removeEventListener');
    const handler = vi.fn<(event: Event) => void>();
    const options: AddEventListenerOptions = { capture: true,
      once: true };

    listeners.on(element, 'keydown', handler, options);

    expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', handler, options);

    listeners.off(element, 'keydown', handler);

    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', handler, options);
    expect(getStoredListeners(listeners)).toHaveLength(0);
  });

  it('removes all listeners for an element and event when handler is omitted', () => {
    const handlerA = vi.fn<(event: Event) => void>();
    const handlerB = vi.fn<(event: Event) => void>();

    listeners.on(element, 'mousemove', handlerA);
    listeners.on(element, 'mousemove', handlerB);
    const removeEventListenerSpy = vi.spyOn(element, 'removeEventListener');

    listeners.off(element, 'mousemove');

    expect(removeEventListenerSpy).toHaveBeenCalledTimes(2);
    expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', handlerA, false);
    expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', handlerB, false);
    expect(getStoredListeners(listeners)).toHaveLength(0);
  });

  it('removes a listener by its id', () => {
    vi.spyOn(Utils, 'generateId').mockReturnValue('listener-id');
    const handler = vi.fn<(event: Event) => void>();
    const removeEventListenerSpy = vi.spyOn(element, 'removeEventListener');

    const id = listeners.on(element, 'wheel', handler);

    if (!id) {
      throw new Error('Listener id should be defined');
    }

    listeners.offById(id);

    expect(removeEventListenerSpy).toHaveBeenCalledWith('wheel', handler, false);
    expect(getStoredListeners(listeners)).toHaveLength(0);
  });

  it('finds the first matching listener', () => {
    const handlerA = vi.fn<(event: Event) => void>();
    const handlerB = vi.fn<(event: Event) => void>();

    listeners.on(element, 'click', handlerA);
    listeners.on(element, 'click', handlerB);

    const found = listeners.findOne(element, 'click');

    expect(found).not.toBeNull();
    expect(found?.handler).toBe(handlerA);
  });

  it('returns null when listener is not found', () => {
    const found = listeners.findOne(element, 'scroll');

    expect(found).toBeNull();
  });

  it('returns all listeners for the provided element when event type is omitted', () => {
    const secondHandler = vi.fn<(event: Event) => void>();

    listeners.on(element, 'click', vi.fn<(event: Event) => void>());
    listeners.on(element, 'keydown', secondHandler);

    const found = listeners.findAll(element);

    expect(found).toHaveLength(2);
    expect(found.map((item) => item.eventType)).toEqual(expect.arrayContaining(['click', 'keydown']));
  });

  it('removes every registered listener on removeAll', () => {
    const otherElement = document.createElement('button');
    const clickHandler = vi.fn<(event: Event) => void>();
    const keydownHandler = vi.fn<(event: Event) => void>();

    listeners.on(element, 'click', clickHandler);
    listeners.on(otherElement, 'keydown', keydownHandler);
    const removeEventListenerSpyElement = vi.spyOn(element, 'removeEventListener');
    const removeEventListenerSpyOther = vi.spyOn(otherElement, 'removeEventListener');

    listeners.removeAll();

    expect(removeEventListenerSpyElement).toHaveBeenCalledWith('click', clickHandler, false);
    expect(removeEventListenerSpyOther).toHaveBeenCalledWith('keydown', keydownHandler, false);
    expect(getStoredListeners(listeners)).toHaveLength(0);
  });

  it('removes all listeners on destroy', () => {
    const otherElement = document.createElement('button');
    const clickHandler = vi.fn<(event: Event) => void>();
    const keydownHandler = vi.fn<(event: Event) => void>();

    listeners.on(element, 'click', clickHandler);
    listeners.on(otherElement, 'keydown', keydownHandler);

    listeners.destroy();

    expect(getStoredListeners(listeners)).toHaveLength(0);
  });

  // Every block binds and unbinds listeners: a scan of all of them per call made each new table cell cost more in a long document.
  it('binds and unbinds one listener with the same array work however many are registered', () => {
    const workFor = (registered: number): number => {
      const registry = new Listeners();

      Array.from({ length: registered }).forEach(() => registry.on(document.createElement('div'), 'click', () => undefined));

      const visited = { count: 0 };
      const methods = ['filter', 'find', 'indexOf', 'splice', 'findIndex', 'some'] as const;
      const spies = methods.map(name => {
        const original = Array.prototype[name] as (...args: unknown[]) => unknown;

        return vi.spyOn(Array.prototype, name).mockImplementation(function (this: unknown[], ...args: unknown[]) {
          visited.count += this.length;

          return original.apply(this, args);
        });
      });
      const target = document.createElement('div');
      const id = registry.on(target, 'click', () => undefined);

      registry.offById(id ?? '');
      spies.forEach(spy => spy.mockRestore());

      return visited.count;
    };

    expect(workFor(2000)).toBe(workFor(10));
  });
});

