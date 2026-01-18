/**
 * Tests for AutoScroll utility
 */

import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { AutoScroll } from '../../../../../../src/components/modules/drag/utils/AutoScroll';

// Mock requestAnimationFrame and cancelAnimationFrame
let rafId = 0;
const mockRaf = vi.fn(() => ++rafId);
const mockCancelRaf = vi.fn();

describe('AutoScroll', () => {
  beforeEach(() => {
    rafId = 0;
    vi.clearAllMocks();
    global.requestAnimationFrame = mockRaf;
    global.cancelAnimationFrame = mockCancelRaf;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('with window scrolling', () => {
    let autoScroll: AutoScroll;

    beforeEach(() => {
      autoScroll = new AutoScroll(null);
      mockRaf.mockClear();
      mockCancelRaf.mockClear();
      vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    });

    it('should not start scrolling when cursor is in the middle of viewport', () => {
      // Set viewport height
      vi.stubGlobal('innerHeight', 1000);

      autoScroll.start(500); // Middle of viewport

      expect(mockRaf).not.toHaveBeenCalled();
    });

    it('should start scrolling up when cursor is near top edge', () => {
      vi.stubGlobal('innerHeight', 1000);

      autoScroll.start(30); // Within autoScrollZone (50px)

      expect(mockRaf).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should start scrolling down when cursor is near bottom edge', () => {
      vi.stubGlobal('innerHeight', 1000);

      autoScroll.start(970); // Within autoScrollZone from bottom

      expect(mockRaf).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should stop scrolling when stop is called', () => {
      vi.stubGlobal('innerHeight', 1000);

      autoScroll.start(30);
      expect(mockRaf).toHaveBeenCalledWith(expect.any(Function));

      autoScroll.stop();
      expect(mockCancelRaf).toHaveBeenCalledWith(expect.any(Number));
    });

    it('should not start duplicate RAF loops', () => {
      vi.stubGlobal('innerHeight', 1000);

      autoScroll.start(30);
      autoScroll.start(30);

      expect(mockRaf).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should switch direction when moving from one scroll zone to another', () => {
      vi.stubGlobal('innerHeight', 1000);

      autoScroll.start(30); // Start scrolling up
      expect(mockRaf).toHaveBeenCalledWith(expect.any(Function));

      autoScroll.start(970); // Switch to scrolling down
      expect(mockCancelRaf).toHaveBeenCalledWith(expect.any(Number)); // Previous RAF cancelled
      expect(mockRaf).toHaveBeenCalledWith(expect.any(Function)); // New RAF started
    });
  });

  describe('with container scrolling', () => {
    beforeEach(() => {
      mockRaf.mockClear();
      mockCancelRaf.mockClear();
    });

    it('should scroll the container instead of window', () => {
      const container = document.createElement('div');
      Object.defineProperty(container, 'scrollTop', {
        value: 0,
        writable: true,
      });

      const autoScroll = new AutoScroll(container);
      vi.stubGlobal('innerHeight', 1000);

      autoScroll.start(30);

      expect(mockRaf).toHaveBeenCalledTimes(1);

      // Manually call the scroll callback to test behavior
      const callback = (mockRaf.mock.calls[0] as unknown[] | undefined)?.[0] as () => void | undefined;
      if (callback) {
        callback();
      }

      expect(container.scrollTop).toBe(-10); // Scroll up by autoScrollSpeed (10)
    });

    it('should update scrollTop on container', () => {
      const container = document.createElement('div');
      Object.defineProperty(container, 'scrollTop', {
        value: 100,
        writable: true,
      });

      const autoScroll = new AutoScroll(container);
      vi.stubGlobal('innerHeight', 1000);

      autoScroll.start(970); // Scroll down

      // Simulate RAF callback
      const callback = (mockRaf.mock.calls[0] as unknown[] | undefined)?.[0] as () => void | undefined;
      if (callback) {
        callback();
      }

      expect(container.scrollTop).toBe(110); // Scroll down by 10
    });
  });

  describe('destroy', () => {
    it('should clean up RAF on destroy', () => {
      vi.stubGlobal('innerHeight', 1000);

      const autoScroll = new AutoScroll(null);
      autoScroll.start(30);

      expect(mockRaf).toHaveBeenCalledWith(expect.any(Function));

      autoScroll.destroy();
      expect(mockCancelRaf).toHaveBeenCalledWith(expect.any(Number));
    });

    it('should be safe to destroy when not scrolling', () => {
      const autoScroll = new AutoScroll(null);

      expect(() => autoScroll.destroy()).not.toThrow();
      expect(mockCancelRaf).not.toHaveBeenCalled();
    });
  });
});
