import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InlineToolEventManager,
  type InlineToolEventHandler,
} from '../../../../../src/components/inline-tools/services/inline-tool-event-manager';

describe('InlineToolEventManager', () => {
  beforeEach(() => {
    InlineToolEventManager.reset();
  });

  afterEach(() => {
    InlineToolEventManager.reset();
  });

  describe('getInstance', () => {
    it('returns the same instance on multiple calls', () => {
      const instance1 = InlineToolEventManager.getInstance();
      const instance2 = InlineToolEventManager.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  describe('reset', () => {
    it('creates a new instance after reset', () => {
      const instance1 = InlineToolEventManager.getInstance();

      InlineToolEventManager.reset();

      const instance2 = InlineToolEventManager.getInstance();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('acquire/release', () => {
    it('keeps listening when an editor is released twice while another still uses it', () => {
      const first = {};
      const second = {};
      const onSelectionChange = vi.fn();

      InlineToolEventManager.acquire(first);
      InlineToolEventManager.acquire(second);
      InlineToolEventManager.getInstance().register('test-tool', { onSelectionChange });
      InlineToolEventManager.release(first);
      InlineToolEventManager.release(first);

      document.dispatchEvent(new Event('selectionchange'));

      expect(onSelectionChange).toHaveBeenCalledTimes(1);
    });
  });

  describe('register/unregister', () => {
    it('registers a handler', () => {
      const manager = InlineToolEventManager.getInstance();
      const handler: InlineToolEventHandler = {
        onSelectionChange: vi.fn(),
      };

      manager.register('test-tool', handler);

      expect(manager.hasHandler('test-tool')).toBe(true);
    });

    it('unregisters a handler', () => {
      const manager = InlineToolEventManager.getInstance();
      const handler: InlineToolEventHandler = {
        onSelectionChange: vi.fn(),
      };

      manager.register('test-tool', handler);
      manager.unregister('test-tool');

      expect(manager.hasHandler('test-tool')).toBe(false);
    });
  });

  describe('event dispatching', () => {
    it('dispatches selectionchange to relevant handlers', () => {
      const manager = InlineToolEventManager.getInstance();
      const receivedSelections: Selection[] = [];
      const onSelectionChange = vi.fn((selection: Selection) => {
        receivedSelections.push(selection);
      });

      manager.register('test-tool', {
        onSelectionChange,
        isRelevant: () => true,
      });

      document.dispatchEvent(new Event('selectionchange'));

      expect(onSelectionChange).toHaveBeenCalled();
      expect(receivedSelections).toHaveLength(1);
      expect(receivedSelections[0]).toBe(window.getSelection());
    });

    it('does not dispatch to handlers where isRelevant returns false', () => {
      const manager = InlineToolEventManager.getInstance();
      const onSelectionChange = vi.fn();

      manager.register('test-tool', {
        onSelectionChange,
        isRelevant: () => false,
      });

      document.dispatchEvent(new Event('selectionchange'));

      expect(onSelectionChange).not.toHaveBeenCalled();
    });

    it('dispatches input events to relevant handlers', () => {
      const manager = InlineToolEventManager.getInstance();
      const receivedEvents: { event: Event; selection: Selection }[] = [];
      const onInput = vi.fn((event: Event, selection: Selection) => {
        receivedEvents.push({ event, selection });
      });

      manager.register('test-tool', {
        onInput,
        isRelevant: () => true,
      });

      // Simulate actual user interaction with an editable element
      const editable = document.createElement('div');
      editable.contentEditable = 'true';
      document.body.appendChild(editable);

      // Focus and type to trigger natural input event
      editable.focus();
      editable.textContent = 'a';
      // Use an InputEvent for realistic user interaction simulation
      const userEvent = new InputEvent('input', { bubbles: true, data: 'a' });
      editable.dispatchEvent(userEvent);

      expect(onInput).toHaveBeenCalled();
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].selection).toBe(window.getSelection());

      document.body.removeChild(editable);
    });

    it('stops listening after reset', () => {
      const manager = InlineToolEventManager.getInstance();
      const onSelectionChange = vi.fn();

      manager.register('test-tool', {
        onSelectionChange,
        isRelevant: () => true,
      });

      InlineToolEventManager.reset();

      document.dispatchEvent(new Event('selectionchange'));

      expect(onSelectionChange).not.toHaveBeenCalled();
    });
  });

  describe('plain-text fields', () => {
    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('blocks a format shortcut there without running the tool', () => {
      const field = document.createElement('div');

      field.setAttribute('contenteditable', 'true');
      field.setAttribute('data-blok-plain-text', '');
      field.textContent = 'Episode 12';
      document.body.appendChild(field);
      window.getSelection()?.selectAllChildren(field);

      const onShortcut = vi.fn();

      InlineToolEventManager.getInstance().register('bold', { shortcut: { key: 'b', meta: true }, onShortcut });

      // Both modifiers, so the shortcut matches on every platform.
      const press = (target: HTMLElement): KeyboardEvent => {
        const event = new KeyboardEvent('keydown', { key: 'b', metaKey: true, ctrlKey: true, bubbles: true, cancelable: true });

        target.dispatchEvent(event);

        return event;
      };
      const event = press(field);

      expect(onShortcut).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);

      const prose = document.createElement('div');

      prose.setAttribute('contenteditable', 'true');
      prose.textContent = 'Body text';
      document.body.appendChild(prose);
      window.getSelection()?.selectAllChildren(prose);
      press(prose);

      expect(onShortcut).toHaveBeenCalledTimes(1);
    });
  });
});
