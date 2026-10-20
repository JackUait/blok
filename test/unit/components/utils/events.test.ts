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

    it('a listener that returns nothing keeps the payload for the next one', () => {
      const firstHandler = vi.fn();
      const secondHandler = vi.fn();

      dispatcher.on('simple', firstHandler);
      dispatcher.on('simple', secondHandler);

      dispatcher.emit('simple', 'start');

      expect(secondHandler).toHaveBeenCalledWith('start');
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

  // Matches DOM EventTarget dispatch: the listener list is cloned at the
  // start, and a listener removed mid-dispatch is skipped (its "removed" flag).
  // https://dom.spec.whatwg.org/#concept-event-listener-inner-invoke
  describe('listener list changes during emit', () => {
    it('runs the listener after a once listener on the same emit', () => {
      const calls: string[] = [];

      dispatcher.once('simple', () => calls.push('once'));
      dispatcher.on('simple', () => calls.push('next'));

      dispatcher.emit('simple', 'payload');

      expect(calls).toEqual(['once', 'next']);
    });

    it('runs the listener after a once listener in emitNotification', () => {
      const calls: string[] = [];

      dispatcher.once('simple', () => calls.push('once'));
      dispatcher.on('simple', () => calls.push('next'));

      dispatcher.emitNotification('simple', 'payload');

      expect(calls).toEqual(['once', 'next']);
    });

    it('skips a later listener that an earlier one removed', () => {
      const later = vi.fn();

      dispatcher.on('simple', () => dispatcher.off('simple', later));
      dispatcher.on('simple', later);

      dispatcher.emit('simple', 'payload');

      expect(later).not.toHaveBeenCalled();
    });

    it('skips a later listener removed during emitNotification', () => {
      const later = vi.fn();

      dispatcher.on('simple', () => dispatcher.off('simple', later));
      dispatcher.on('simple', later);

      dispatcher.emitNotification('simple', 'payload');

      expect(later).not.toHaveBeenCalled();
    });

    it('does not run a listener added during the same emit', () => {
      const added = vi.fn();

      dispatcher.on('simple', () => dispatcher.on('simple', added));

      dispatcher.emit('simple', 'payload');

      expect(added).not.toHaveBeenCalled();

      dispatcher.emit('simple', 'again');

      expect(added).toHaveBeenCalledWith('again');
    });

    it('skips the remaining listeners after destroy during emit', () => {
      const later = vi.fn();

      dispatcher.on('simple', () => dispatcher.destroy());
      dispatcher.on('simple', later);

      dispatcher.emit('simple', 'payload');

      expect(later).not.toHaveBeenCalled();
    });

    it('does not run a listener added during the same emitNotification', () => {
      const added = vi.fn();

      dispatcher.on('simple', () => dispatcher.on('simple', added));

      dispatcher.emitNotification('simple', 'payload');

      expect(added).not.toHaveBeenCalled();
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

