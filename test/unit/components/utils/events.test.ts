import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventsDispatcher } from '../../../../src/components/utils/events';

type TestEventMap = {
  simple: string;
  numeric: number;
};

describe('EventsDispatcher', () => {
  let dispatcher: EventsDispatcher<TestEventMap>;

  beforeEach(() => {
    dispatcher = new EventsDispatcher<TestEventMap>();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('on & emit', () => {
    it('calls all subscribers with emitted data', () => {
      const firstHandler = vi.fn();
      const secondHandler = vi.fn();

      dispatcher.on('simple', firstHandler);
      dispatcher.on('simple', secondHandler);

      dispatcher.emit('simple', 'payload');

      expect(firstHandler).toHaveBeenCalledTimes(1);
      expect(firstHandler).toHaveBeenCalledWith('payload');
      expect(secondHandler).toHaveBeenCalledTimes(1);
      expect(secondHandler).toHaveBeenCalledWith('payload');
    });

    it('pipes returned data between listeners', () => {
      const firstHandler = vi.fn((value: string) => `${value} -> first`);
      const secondHandler = vi.fn((value: string) => `${value} -> second`);

      dispatcher.on('simple', firstHandler);
      dispatcher.on('simple', secondHandler);

      dispatcher.emit('simple', 'start');

      expect(firstHandler).toHaveBeenCalledWith('start');
      expect(secondHandler).toHaveBeenCalledWith('start -> first');
    });

    it('retains previous data when listener returns undefined', () => {
      const firstHandler = vi.fn(() => undefined);
      const secondHandler = vi.fn();

      dispatcher.on('simple', firstHandler);
      dispatcher.on('simple', secondHandler);

      dispatcher.emit('simple', 'initial');

      expect(firstHandler).toHaveBeenCalledWith('initial');
      expect(secondHandler).toHaveBeenCalledWith('initial');
    });
  });

  describe('once', () => {
    it('removes listener after first invocation', () => {
      const handler = vi.fn();

      dispatcher.once('simple', handler);

      dispatcher.emit('simple', 'first');
      dispatcher.emit('simple', 'second');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith('first');
    });
  });

  describe('off', () => {
    it('removes a specific listener', () => {
      const handlerToRemove = vi.fn();
      const remainingHandler = vi.fn();

      dispatcher.on('simple', handlerToRemove);
      dispatcher.on('simple', remainingHandler);

      dispatcher.off('simple', handlerToRemove);

      dispatcher.emit('simple', 'payload');

      expect(handlerToRemove).not.toHaveBeenCalled();
      expect(remainingHandler).toHaveBeenCalledTimes(1);
      expect(remainingHandler).toHaveBeenCalledWith('payload');
    });

    it('warns when trying to remove listener from unknown event', () => {
      const handler = vi.fn();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      dispatcher.off('simple', handler);

      expect(warnSpy).toHaveBeenCalledWith(
        'EventDispatcher .off(): there is no subscribers for event "simple". Probably, .off() called before .on()'
      );
    });
  });

  describe('destroy', () => {
    it('clears all subscribers', () => {
      const handler = vi.fn();

      dispatcher.on('simple', handler);
      dispatcher.on('numeric', vi.fn());

      dispatcher.destroy();

      dispatcher.emit('simple', 'payload');
      dispatcher.emit('numeric', 42);

      expect(handler).not.toHaveBeenCalled();
    });
  });
});

