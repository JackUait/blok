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
      const onSelectionChange = vi.fn();

      manager.register('test-tool', {
        onSelectionChange,
        isRelevant: () => true,
      });

      document.dispatchEvent(new Event('selectionchange'));

      expect(onSelectionChange).toHaveBeenCalled();
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
      const onInput = vi.fn();

      manager.register('test-tool', {
        onInput,
        isRelevant: () => true,
      });

      document.dispatchEvent(new Event('input'));

      expect(onInput).toHaveBeenCalled();
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
});
