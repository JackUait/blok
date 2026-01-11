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
});
