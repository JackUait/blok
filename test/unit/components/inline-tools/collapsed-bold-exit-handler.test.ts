import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CollapsedBoldExitHandler } from '../../../../src/components/inline-tools/collapsed-bold-exit-handler';

describe('CollapsedBoldExitHandler', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    CollapsedBoldExitHandler.reset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    CollapsedBoldExitHandler.reset();
  });

  describe('getInstance', () => {
    it('returns a singleton instance', () => {
      const instance1 = CollapsedBoldExitHandler.getInstance();
      const instance2 = CollapsedBoldExitHandler.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('returns instance of CollapsedBoldExitHandler', () => {
      const instance = CollapsedBoldExitHandler.getInstance();

      expect(instance).toBeInstanceOf(CollapsedBoldExitHandler);
    });
  });

  describe('hasActiveRecords', () => {
    it('returns false when no records exist', () => {
      const handler = CollapsedBoldExitHandler.getInstance();

      expect(handler.hasActiveRecords()).toBe(false);
    });
  });
});
