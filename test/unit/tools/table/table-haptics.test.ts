import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hapticTick, hapticSnap } from '../../../../src/tools/table/table-haptics';

describe('table-haptics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('hapticTick', () => {
    it('calls navigator.vibrate with 8ms when supported', () => {
      const vibrate = vi.fn();

      Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });

      hapticTick();

      expect(vibrate).toHaveBeenCalledWith(8);
    });

    it('does not throw when navigator.vibrate is undefined', () => {
      Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true });

      expect(() => hapticTick()).not.toThrow();
    });
  });

  describe('hapticSnap', () => {
    it('calls navigator.vibrate with 15ms when supported', () => {
      const vibrate = vi.fn();

      Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });

      hapticSnap();

      expect(vibrate).toHaveBeenCalledWith(15);
    });

    it('does not throw when navigator.vibrate is undefined', () => {
      Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true });

      expect(() => hapticSnap()).not.toThrow();
    });
  });
});
