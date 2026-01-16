import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ClickDragHandler } from '../../../../../src/components/modules/toolbar/click-handler';
import { DRAG_THRESHOLD } from '../../../../../src/components/modules/toolbar/constants';

// Store the actual addEventListener and removeEventListener to call them in tests
const actualAddEventListener = document.addEventListener.bind(document);
const actualRemoveEventListener = document.removeEventListener.bind(document);

// Track mouseup listeners for testing
let mouseupListeners: Array<Parameters<typeof document.addEventListener>> = [];

vi.mock('../../../../../src/components/utils', async () => {
  const actual = await vi.importActual('../../../../../src/components/utils');

  return {
    ...actual,
  };
});

vi.stubGlobal('document', {
  ...document,
  addEventListener: vi.fn((...args: Parameters<typeof document.addEventListener>) => {
    const [event, listener] = args;
    if (event === 'mouseup') {
      mouseupListeners.push([event, listener, args[2]]);
    }
    return actualAddEventListener(...args);
  }),
  removeEventListener: vi.fn((...args: Parameters<typeof document.removeEventListener>) => {
    const [_event, listener] = args;
    const index = mouseupListeners.findIndex(
      ([, l]) => l === listener
    );
    if (index > -1) {
      mouseupListeners.splice(index, 1);
    }
    return actualRemoveEventListener(...args);
  }),
});

describe('ClickDragHandler', () => {
  let handler: ClickDragHandler;

  beforeEach(() => {
    handler = new ClickDragHandler();
    mouseupListeners = [];
  });

  afterEach(() => {
    handler.destroy();
    mouseupListeners = [];
  });

  describe('setup', () => {
    it('registers document-level mouseup listener on setup', () => {
      const mousedownEvent = new MouseEvent('mousedown', { clientX: 100, clientY: 100 });

      handler.setup(mousedownEvent, vi.fn());

      expect(mouseupListeners).toHaveLength(1);
    });

    it('fires callback when mouseup occurs without movement', () => {
      const callback = vi.fn();
      const mousedownEvent = new MouseEvent('mousedown', { clientX: 100, clientY: 100 });

      handler.setup(mousedownEvent, callback);

      const mouseupEvent = new MouseEvent('mouseup', { clientX: 100, clientY: 100 });
      const [, mouseupListener] = mouseupListeners[0];
      if (typeof mouseupListener === 'function') {
        mouseupListener(mouseupEvent);
      } else {
        mouseupListener.handleEvent(mouseupEvent);
      }

      expect(callback).toHaveBeenCalledWith(mouseupEvent);
    });

    it('fires callback when mouseup occurs with movement within threshold', () => {
      const callback = vi.fn();
      const mousedownEvent = new MouseEvent('mousedown', { clientX: 100, clientY: 100 });

      handler.setup(mousedownEvent, callback);

      const mouseupEvent = new MouseEvent('mouseup', { clientX: 105, clientY: 105 });
      const [, mouseupListener] = mouseupListeners[0];
      if (typeof mouseupListener === 'function') {
        mouseupListener(mouseupEvent);
      } else {
        mouseupListener.handleEvent(mouseupEvent);
      }

      expect(callback).toHaveBeenCalledWith(mouseupEvent);
    });

    it('does not fire callback when mouseup exceeds X threshold', () => {
      const callback = vi.fn();
      const mousedownEvent = new MouseEvent('mousedown', { clientX: 100, clientY: 100 });

      handler.setup(mousedownEvent, callback);

      const mouseupEvent = new MouseEvent('mouseup', { clientX: 100 + DRAG_THRESHOLD + 1, clientY: 100 });
      const [, mouseupListener] = mouseupListeners[0];
      if (typeof mouseupListener === 'function') {
        mouseupListener(mouseupEvent);
      } else {
        mouseupListener.handleEvent(mouseupEvent);
      }

      expect(callback).not.toHaveBeenCalled();
    });

    it('does not fire callback when mouseup exceeds Y threshold', () => {
      const callback = vi.fn();
      const mousedownEvent = new MouseEvent('mousedown', { clientX: 100, clientY: 100 });

      handler.setup(mousedownEvent, callback);

      const mouseupEvent = new MouseEvent('mouseup', { clientX: 100, clientY: 100 + DRAG_THRESHOLD + 1 });
      const [, mouseupListener] = mouseupListeners[0];
      if (typeof mouseupListener === 'function') {
        mouseupListener(mouseupEvent);
      } else {
        mouseupListener.handleEvent(mouseupEvent);
      }

      expect(callback).not.toHaveBeenCalled();
    });

    it('does not fire callback when both X and Y exceed threshold', () => {
      const callback = vi.fn();
      const mousedownEvent = new MouseEvent('mousedown', { clientX: 100, clientY: 100 });

      handler.setup(mousedownEvent, callback);

      const mouseupEvent = new MouseEvent('mouseup', {
        clientX: 100 + DRAG_THRESHOLD + 1,
        clientY: 100 + DRAG_THRESHOLD + 1,
      });
      const [, mouseupListener] = mouseupListeners[0];
      if (typeof mouseupListener === 'function') {
        mouseupListener(mouseupEvent);
      } else {
        mouseupListener.handleEvent(mouseupEvent);
      }

      expect(callback).not.toHaveBeenCalled();
    });

    it('removes mouseup listener after callback is called', () => {
      const mousedownEvent = new MouseEvent('mousedown', { clientX: 100, clientY: 100 });

      handler.setup(mousedownEvent, vi.fn());

      const mouseupEvent = new MouseEvent('mouseup', { clientX: 100, clientY: 100 });
      const [, mouseupListener] = mouseupListeners[0];
      if (typeof mouseupListener === 'function') {
        mouseupListener(mouseupEvent);
      } else {
        mouseupListener.handleEvent(mouseupEvent);
      }

      expect(mouseupListeners).toHaveLength(0);
    });
  });

  describe('with beforeCallback option', () => {
    it('fires callback when beforeCallback returns true', () => {
      const callback = vi.fn();
      const beforeCallback = vi.fn(() => true);
      const mousedownEvent = new MouseEvent('mousedown', { clientX: 100, clientY: 100 });

      handler.setup(mousedownEvent, callback, { beforeCallback });

      const mouseupEvent = new MouseEvent('mouseup', { clientX: 100, clientY: 100 });
      const [, mouseupListener] = mouseupListeners[0];
      if (typeof mouseupListener === 'function') {
        mouseupListener(mouseupEvent);
      } else {
        mouseupListener.handleEvent(mouseupEvent);
      }

      expect(beforeCallback).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(mouseupEvent);
    });

    it('does not fire callback when beforeCallback returns false', () => {
      const callback = vi.fn();
      const beforeCallback = vi.fn(() => false);
      const mousedownEvent = new MouseEvent('mousedown', { clientX: 100, clientY: 100 });

      handler.setup(mousedownEvent, callback, { beforeCallback });

      const mouseupEvent = new MouseEvent('mouseup', { clientX: 100, clientY: 100 });
      const [, mouseupListener] = mouseupListeners[0];
      if (typeof mouseupListener === 'function') {
        mouseupListener(mouseupEvent);
      } else {
        mouseupListener.handleEvent(mouseupEvent);
      }

      expect(beforeCallback).toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('cancelPending', () => {
    it('removes all pending mouseup listeners', () => {
      const mousedownEvent1 = new MouseEvent('mousedown', { clientX: 100, clientY: 100 });
      const mousedownEvent2 = new MouseEvent('mousedown', { clientX: 200, clientY: 200 });

      handler.setup(mousedownEvent1, vi.fn());
      handler.setup(mousedownEvent2, vi.fn());

      expect(mouseupListeners).toHaveLength(2);

      handler.cancelPending();

      expect(mouseupListeners).toHaveLength(0);
    });
  });

  describe('destroy', () => {
    it('removes all pending mouseup listeners when destroyed', () => {
      const mousedownEvent1 = new MouseEvent('mousedown', { clientX: 100, clientY: 100 });
      const mousedownEvent2 = new MouseEvent('mousedown', { clientX: 200, clientY: 200 });

      handler.setup(mousedownEvent1, vi.fn());
      handler.setup(mousedownEvent2, vi.fn());

      expect(mouseupListeners).toHaveLength(2);

      handler.destroy();

      expect(mouseupListeners).toHaveLength(0);
    });

    it('cleans up listeners even if mouseup never fired', () => {
      const mousedownEvent = new MouseEvent('mousedown', { clientX: 100, clientY: 100 });

      handler.setup(mousedownEvent, vi.fn());

      expect(mouseupListeners).toHaveLength(1);

      handler.destroy();

      expect(mouseupListeners).toHaveLength(0);
    });
  });
});
