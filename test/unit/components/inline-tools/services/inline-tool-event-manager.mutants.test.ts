import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  InlineToolEventManager,
  type InlineToolEventHandler,
} from '../../../../../src/components/inline-tools/services/inline-tool-event-manager';

const MAC_AGENT = 'mozilla/5.0 (macintosh; intel mac os x 10_15_7)';
const WINDOWS_AGENT = 'mozilla/5.0 (windows nt 10.0; win64; x64)';

const useAgent = (agent: string): void => {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(agent);
};

interface Fixture {
  manager: InlineToolEventManager;
  editable: HTMLElement;
  text: Node;
}

const setup = (): Fixture => {
  const editable = document.createElement('div');

  editable.contentEditable = 'true';
  editable.textContent = 'hello';
  document.body.appendChild(editable);

  const text = editable.firstChild;

  if (text === null) {
    throw new Error('fixture has no text node');
  }

  const range = document.createRange();

  range.setStart(text, 1);
  range.collapse(true);

  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);

  return { manager: InlineToolEventManager.getInstance(), editable, text };
};

/**
 * Dispatches an event and reports what happened to it and around it.
 *
 * `bubbled` and `sawLateDocumentListener` are what tell `stopPropagation` and
 * `stopImmediatePropagation` apart: the first is a listener on the target, the
 * second a capture listener on document registered after the manager's.
 *
 * `errors` is not decoration. jsdom routes a throw inside `dispatchEvent` to
 * window's error event rather than to the caller, so an optional-chaining mutant
 * that turns a missing callback into a TypeError passes unless it is asserted.
 */
const fire = (target: EventTarget, event: Event): {
  defaultPrevented: boolean;
  bubbled: boolean;
  sawLateDocumentListener: boolean;
  errors: unknown[];
} => {
  let bubbled = false;
  let sawLateDocumentListener = false;
  const errors: unknown[] = [];

  const onTarget = (): void => {
    bubbled = true;
  };
  const onLateDocument = (): void => {
    sawLateDocumentListener = true;
  };
  const onError = (errorEvent: ErrorEvent): void => {
    errors.push(errorEvent.error ?? errorEvent.message);
    errorEvent.preventDefault();
  };

  target.addEventListener(event.type, onTarget);
  document.addEventListener(event.type, onLateDocument, true);
  window.addEventListener('error', onError);

  try {
    target.dispatchEvent(event);
  } finally {
    target.removeEventListener(event.type, onTarget);
    document.removeEventListener(event.type, onLateDocument, true);
    window.removeEventListener('error', onError);
  }

  return { defaultPrevented: event.defaultPrevented, bubbled, sawLateDocumentListener, errors };
};

const keydown = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', {
  bubbles: true,
  cancelable: true,
  ...init,
});

describe('InlineToolEventManager mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    InlineToolEventManager.reset();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    InlineToolEventManager.reset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.getSelection()?.removeAllRanges();
  });

  describe('shortcut matching', () => {
    const registerBold = (manager: InlineToolEventManager, extra: Partial<InlineToolEventHandler> = {}) => {
      const onShortcut = vi.fn();

      manager.register('bold', { shortcut: { key: 'b', meta: true }, onShortcut, ...extra });

      return onShortcut;
    };

    it('runs the shortcut and swallows the keystroke', () => {
      useAgent(MAC_AGENT);

      const { manager, editable } = setup();
      const onShortcut = registerBold(manager);

      const result = fire(editable, keydown({ key: 'B', metaKey: true }));

      expect(onShortcut).toHaveBeenCalledTimes(1);
      expect(result.defaultPrevented).toBe(true);
      expect(result.bubbled).toBe(false);
      expect(result.sawLateDocumentListener).toBe(false);
      expect(result.errors).toEqual([]);
    });

    it('ignores a different key', () => {
      useAgent(MAC_AGENT);

      const { manager, editable } = setup();
      const onShortcut = registerBold(manager);

      const result = fire(editable, keydown({ key: 'x', metaKey: true }));

      expect(onShortcut).not.toHaveBeenCalled();
      expect(result.defaultPrevented).toBe(false);
      expect(result.bubbled).toBe(true);
    });

    it('ignores the shortcut when Alt is held', () => {
      useAgent(MAC_AGENT);

      const { manager, editable } = setup();
      const onShortcut = registerBold(manager);

      fire(editable, keydown({ key: 'b', metaKey: true, altKey: true }));

      expect(onShortcut).not.toHaveBeenCalled();
    });

    it('ignores a meta shortcut pressed with no modifier', () => {
      useAgent(MAC_AGENT);

      const { manager, editable } = setup();
      const onShortcut = registerBold(manager);

      const result = fire(editable, keydown({ key: 'b' }));

      expect(onShortcut).not.toHaveBeenCalled();
      expect(result.defaultPrevented).toBe(false);
    });

    it('reads Ctrl as the primary modifier away from a Mac', () => {
      useAgent(WINDOWS_AGENT);

      const { manager, editable } = setup();
      const onShortcut = registerBold(manager);

      fire(editable, keydown({ key: 'b', ctrlKey: true }));

      expect(onShortcut).toHaveBeenCalledTimes(1);
    });

    it('ignores Cmd away from a Mac', () => {
      useAgent(WINDOWS_AGENT);

      const { manager, editable } = setup();
      const onShortcut = registerBold(manager);

      fire(editable, keydown({ key: 'b', metaKey: true }));

      expect(onShortcut).not.toHaveBeenCalled();
    });

    it('ignores Ctrl on a Mac', () => {
      useAgent(MAC_AGENT);

      const { manager, editable } = setup();
      const onShortcut = registerBold(manager);

      fire(editable, keydown({ key: 'b', ctrlKey: true }));

      expect(onShortcut).not.toHaveBeenCalled();
    });

    it('runs a Ctrl-only shortcut when Ctrl is held', () => {
      useAgent(MAC_AGENT);

      const { manager, editable } = setup();
      const onShortcut = vi.fn();

      manager.register('code', { shortcut: { key: 'k', ctrl: true }, onShortcut });

      fire(editable, keydown({ key: 'k', ctrlKey: true }));

      expect(onShortcut).toHaveBeenCalledTimes(1);
    });

    it('ignores a Ctrl-only shortcut without Ctrl', () => {
      useAgent(MAC_AGENT);

      const { manager, editable } = setup();
      const onShortcut = vi.fn();

      manager.register('code', { shortcut: { key: 'k', ctrl: true }, onShortcut });

      fire(editable, keydown({ key: 'k', metaKey: true }));

      expect(onShortcut).not.toHaveBeenCalled();
    });
  });

  describe('keydown dispatch', () => {
    it('does nothing without a selection', () => {
      useAgent(MAC_AGENT);

      const { manager, editable } = setup();
      const onShortcut = vi.fn();

      manager.register('bold', { shortcut: { key: 'b', meta: true }, onShortcut });
      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      const result = fire(editable, keydown({ key: 'b', metaKey: true }));

      expect(onShortcut).not.toHaveBeenCalled();
      expect(result.defaultPrevented).toBe(false);
    });

    it('does nothing when the selection holds no range', () => {
      useAgent(MAC_AGENT);

      const { manager, editable } = setup();
      const onShortcut = vi.fn();

      manager.register('bold', { shortcut: { key: 'b', meta: true }, onShortcut });
      window.getSelection()?.removeAllRanges();

      const result = fire(editable, keydown({ key: 'b', metaKey: true }));

      expect(onShortcut).not.toHaveBeenCalled();
      expect(result.defaultPrevented).toBe(false);
    });

    it('leaves a handler with a shortcut but no callback alone', () => {
      useAgent(MAC_AGENT);

      const { manager, editable } = setup();

      manager.register('bold', { shortcut: { key: 'b', meta: true } });

      const result = fire(editable, keydown({ key: 'b', metaKey: true }));

      expect(result.defaultPrevented).toBe(false);
      expect(result.errors).toEqual([]);
    });

    it('leaves a handler with a callback but no shortcut alone', () => {
      useAgent(MAC_AGENT);

      const { manager, editable } = setup();
      const onShortcut = vi.fn();

      manager.register('bold', { onShortcut });

      const result = fire(editable, keydown({ key: 'b', metaKey: true }));

      expect(onShortcut).not.toHaveBeenCalled();
      expect(result.defaultPrevented).toBe(false);
    });

    it('skips a handler that is not relevant to the selection', () => {
      useAgent(MAC_AGENT);

      const { manager, editable } = setup();
      const onShortcut = vi.fn();
      const isRelevant = vi.fn(() => false);

      manager.register('bold', { shortcut: { key: 'b', meta: true }, onShortcut, isRelevant });

      const result = fire(editable, keydown({ key: 'b', metaKey: true }));

      expect(onShortcut).not.toHaveBeenCalled();
      expect(isRelevant).toHaveBeenCalledTimes(1);
      expect(result.defaultPrevented).toBe(false);
    });

    it('runs a handler that is relevant to the selection', () => {
      useAgent(MAC_AGENT);

      const { manager, editable } = setup();
      const onShortcut = vi.fn();

      manager.register('bold', { shortcut: { key: 'b', meta: true }, onShortcut, isRelevant: () => true });

      fire(editable, keydown({ key: 'b', metaKey: true }));

      expect(onShortcut).toHaveBeenCalledTimes(1);
    });

    it('lets a handler decline the keystroke so the browser keeps it', () => {
      useAgent(MAC_AGENT);

      const { manager, editable } = setup();
      const onShortcut = vi.fn();
      const shouldHandleShortcut = vi.fn(() => false);

      manager.register('bold', { shortcut: { key: 'b', meta: true }, onShortcut, shouldHandleShortcut });

      const result = fire(editable, keydown({ key: 'b', metaKey: true }));

      expect(result.defaultPrevented).toBe(false);
      expect(onShortcut).not.toHaveBeenCalled();
      expect(shouldHandleShortcut).toHaveBeenCalledTimes(1);
      expect(result.bubbled).toBe(true);
    });

    it('intercepts the keystroke when the handler accepts it', () => {
      useAgent(MAC_AGENT);

      const { manager, editable } = setup();
      const onShortcut = vi.fn();

      manager.register('bold', {
        shortcut: { key: 'b', meta: true },
        onShortcut,
        shouldHandleShortcut: () => true,
      });

      const result = fire(editable, keydown({ key: 'b', metaKey: true }));

      expect(result.defaultPrevented).toBe(true);
      expect(onShortcut).toHaveBeenCalledTimes(1);
    });
  });

  describe('beforeinput dispatch', () => {
    const beforeinput = (): InputEvent => new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: 'x',
    });

    it('prevents the input when the handler asks for it', () => {
      const { manager, editable } = setup();
      const onBeforeInput = vi.fn(() => true);

      manager.register('marker', { onBeforeInput });

      const result = fire(editable, beforeinput());

      expect(result.defaultPrevented).toBe(true);
      expect(result.bubbled).toBe(false);
      expect(result.sawLateDocumentListener).toBe(false);
      expect(onBeforeInput).toHaveBeenCalledTimes(1);
    });

    it('lets the input through when the handler declines', () => {
      const { manager, editable } = setup();
      const onBeforeInput = vi.fn(() => false);

      manager.register('marker', { onBeforeInput });

      const result = fire(editable, beforeinput());

      expect(result.defaultPrevented).toBe(false);
      expect(result.bubbled).toBe(true);
    });

    it('skips a handler that is not relevant', () => {
      const { manager, editable } = setup();
      const onBeforeInput = vi.fn(() => true);

      manager.register('marker', { onBeforeInput, isRelevant: () => false });

      const result = fire(editable, beforeinput());

      expect(onBeforeInput).not.toHaveBeenCalled();
      expect(result.defaultPrevented).toBe(false);
    });

    it('runs a handler that is relevant', () => {
      const { manager, editable } = setup();
      const onBeforeInput = vi.fn(() => true);

      manager.register('marker', { onBeforeInput, isRelevant: () => true });

      fire(editable, beforeinput());

      expect(onBeforeInput).toHaveBeenCalledTimes(1);
    });

    it('tolerates a handler with no beforeinput callback', () => {
      const { manager, editable } = setup();

      manager.register('marker', { isRelevant: () => true });

      const result = fire(editable, beforeinput());

      expect(result.errors).toEqual([]);
      expect(result.defaultPrevented).toBe(false);
    });

    it('does nothing without a selection', () => {
      const { manager, editable } = setup();
      const onBeforeInput = vi.fn(() => true);

      manager.register('marker', { onBeforeInput });
      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      const result = fire(editable, beforeinput());

      expect(onBeforeInput).not.toHaveBeenCalled();
      expect(result.defaultPrevented).toBe(false);
    });
  });

  describe('input dispatch', () => {
    const input = (): Event => new Event('input', { bubbles: true, cancelable: true });

    it('forwards the event and the selection', () => {
      const { manager, editable } = setup();
      const onInput = vi.fn();

      manager.register('marker', { onInput });

      const event = input();

      fire(editable, event);

      expect(onInput).toHaveBeenCalledTimes(1);
      expect(onInput.mock.calls[0][0]).toBe(event);
      expect(onInput.mock.calls[0][1]).toBe(window.getSelection());
    });

    it('skips a handler that is not relevant', () => {
      const { manager, editable } = setup();
      const onInput = vi.fn();

      manager.register('marker', { onInput, isRelevant: () => false });

      fire(editable, input());

      expect(onInput).not.toHaveBeenCalled();
    });

    it('runs a handler that is relevant', () => {
      const { manager, editable } = setup();
      const onInput = vi.fn();

      manager.register('marker', { onInput, isRelevant: () => true });

      fire(editable, input());

      expect(onInput).toHaveBeenCalledTimes(1);
    });

    it('still sees the input when the block stops the bubble', () => {
      const { manager, editable } = setup();
      const onInput = vi.fn();

      manager.register('marker', { onInput });

      // The listener is registered in the capture phase, so a block that swallows
      // its own input must not blind the manager to it.
      editable.addEventListener('input', (event) => {
        event.stopPropagation();
      });

      fire(editable, input());

      expect(onInput).toHaveBeenCalledTimes(1);
    });

    it('tolerates a handler with no input callback', () => {
      const { manager, editable } = setup();

      manager.register('marker', { isRelevant: () => true });

      expect(fire(editable, input()).errors).toEqual([]);
    });

    it('does nothing without a selection', () => {
      const { manager, editable } = setup();
      const onInput = vi.fn();

      manager.register('marker', { onInput });
      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      fire(editable, input());

      expect(onInput).not.toHaveBeenCalled();
    });
  });

  describe('selectionchange dispatch', () => {
    const selectionchange = (): Event => new Event('selectionchange');

    it('forwards the selection', () => {
      const { manager } = setup();
      const onSelectionChange = vi.fn();

      manager.register('marker', { onSelectionChange });

      fire(document, selectionchange());

      expect(onSelectionChange).toHaveBeenCalledTimes(1);
      expect(onSelectionChange.mock.calls[0][0]).toBe(window.getSelection());
    });

    it('skips a handler that is not relevant', () => {
      const { manager } = setup();
      const onSelectionChange = vi.fn();

      manager.register('marker', { onSelectionChange, isRelevant: () => false });

      fire(document, selectionchange());

      expect(onSelectionChange).not.toHaveBeenCalled();
    });

    it('runs a handler that is relevant', () => {
      const { manager } = setup();
      const onSelectionChange = vi.fn();

      manager.register('marker', { onSelectionChange, isRelevant: () => true });

      fire(document, selectionchange());

      expect(onSelectionChange).toHaveBeenCalledTimes(1);
    });

    it('tolerates a handler with no selection callback', () => {
      const { manager } = setup();

      manager.register('marker', { isRelevant: () => true });

      expect(fire(document, selectionchange()).errors).toEqual([]);
    });

    it('does nothing without a selection', () => {
      const { manager } = setup();
      const onSelectionChange = vi.fn();

      manager.register('marker', { onSelectionChange });
      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      fire(document, selectionchange());

      expect(onSelectionChange).not.toHaveBeenCalled();
    });
  });

  describe('registration', () => {
    it('unregisters a handler so its shortcut stops firing', () => {
      useAgent(MAC_AGENT);

      const { manager, editable } = setup();
      const onShortcut = vi.fn();

      manager.register('bold', { shortcut: { key: 'b', meta: true }, onShortcut });
      expect(manager.hasHandler('bold')).toBe(true);

      manager.unregister('bold');

      expect(manager.hasHandler('bold')).toBe(false);

      fire(editable, keydown({ key: 'b', metaKey: true }));

      expect(onShortcut).not.toHaveBeenCalled();
    });

    it('hands back the same instance', () => {
      const first = InlineToolEventManager.getInstance();

      expect(InlineToolEventManager.getInstance()).toBe(first);
    });

    it('builds a fresh instance after a reset', () => {
      const first = InlineToolEventManager.getInstance();

      first.register('bold', { shortcut: { key: 'b', meta: true }, onShortcut: vi.fn() });
      InlineToolEventManager.reset();

      const second = InlineToolEventManager.getInstance();

      expect(second).not.toBe(first);
      expect(second.hasHandler('bold')).toBe(false);
    });
  });

  describe('listener lifecycle', () => {
    it('clears the previous instance handler map on reset', () => {
      const first = InlineToolEventManager.getInstance();

      first.register('bold', { shortcut: { key: 'b', meta: true }, onShortcut: vi.fn() });
      InlineToolEventManager.reset();

      expect(first.hasHandler('bold')).toBe(false);
    });

    it('detaches the previous instance document listeners on reset', () => {
      useAgent(MAC_AGENT);

      const orphan = InlineToolEventManager.getInstance();
      const onShortcut = vi.fn();
      const onSelectionChange = vi.fn();
      const onInput = vi.fn();
      const onBeforeInput = vi.fn();

      InlineToolEventManager.reset();

      orphan.register('shortcut', { shortcut: { key: 'b', meta: true }, onShortcut });
      orphan.register('selection', { onSelectionChange });
      orphan.register('input', { onInput });
      orphan.register('beforeinput', { onBeforeInput });

      // setup() puts a fresh, empty singleton on the document. It absorbs
      // nothing, so any callback here proves the orphan kept its listener.
      const { editable } = setup();

      fire(editable, keydown({ key: 'b', metaKey: true }));
      fire(editable, new Event('input', { bubbles: true, cancelable: true }));
      fire(editable, new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: 'x' }));
      fire(document, new Event('selectionchange'));

      expect(onShortcut).not.toHaveBeenCalled();
      expect(onSelectionChange).not.toHaveBeenCalled();
      expect(onInput).not.toHaveBeenCalled();
      expect(onBeforeInput).not.toHaveBeenCalled();
    });
  });

  describe('absent globals', () => {
    it('registers nothing when there is no document', () => {
      vi.stubGlobal('document', undefined);

      expect(() => InlineToolEventManager.getInstance()).not.toThrow();
    });

    it('removes nothing when the document is gone', () => {
      const manager = InlineToolEventManager.getInstance();

      manager.register('marker', { onInput: vi.fn() });

      vi.stubGlobal('document', undefined);

      expect(() => InlineToolEventManager.reset()).not.toThrow();
    });

    it('matches a Ctrl shortcut when there is no navigator', () => {
      const { manager, editable } = setup();
      const onShortcut = vi.fn();

      manager.register('code', { shortcut: { key: 'k', ctrl: true }, onShortcut });

      vi.stubGlobal('navigator', undefined);

      const result = fire(editable, keydown({ key: 'k', ctrlKey: true }));

      expect(result.errors).toEqual([]);
      expect(onShortcut).toHaveBeenCalledTimes(1);
    });

    it('falls back to no selection when there is no window', () => {
      const realWindow = window;
      const { manager, editable } = setup();
      const onInput = vi.fn();
      const errors: unknown[] = [];

      manager.register('marker', { onInput });

      const onError = (errorEvent: ErrorEvent): void => {
        errors.push(errorEvent.error ?? errorEvent.message);
        errorEvent.preventDefault();
      };

      // The error recorder has to be wired to the real window object before the
      // global one goes away: a throw inside the manager's listener reaches the
      // test as a window error event, never as a rejected assertion.
      realWindow.addEventListener('error', onError);
      vi.stubGlobal('window', undefined);

      try {
        editable.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      } finally {
        realWindow.removeEventListener('error', onError);
      }

      expect(errors).toEqual([]);
      expect(onInput).not.toHaveBeenCalled();
    });
  });
});
