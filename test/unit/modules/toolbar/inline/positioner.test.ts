import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InlinePositioner } from '../../../../../src/components/modules/toolbar/inline/index';

describe('InlinePositioner', () => {
  let positioner: InlinePositioner;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 600);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('desktop', () => {
    beforeEach(() => {
      positioner = new InlinePositioner(false);
    });

    it('should use desktop vertical margin (6px)', () => {
      expect(positioner).toBeInstanceOf(InlinePositioner);
    });

    it('should calculate and apply position to wrapper element', () => {
      const wrapper = document.createElement('div');
      const selectionRect: DOMRect = {
        x: 100,
        y: 100,
        width: 50,
        height: 20,
        top: 100,
        right: 150,
        bottom: 120,
        left: 100,
        toJSON: () => ({}),
      };
      const wrapperOffset: DOMRect = {
        x: 0,
        y: 0,
        width: 1000,
        height: 500,
        top: 0,
        right: 1000,
        bottom: 500,
        left: 0,
        toJSON: () => ({}),
      };
      const contentRect: DOMRect = {
        x: 0,
        y: 0,
        width: 1000,
        height: 500,
        top: 0,
        right: 1000,
        bottom: 500,
        left: 0,
        toJSON: () => ({}),
      };
      const popoverWidth = 200;

      positioner.apply({
        wrapper,
        selectionRect,
        wrapperOffset,
        contentRect,
        popoverWidth,
      });

      // X position: selectionRect.x - wrapperOffset.x = 100 - 0 = 100
      expect(wrapper.style.left).toBe('100px');
      // Y position: selectionRect.y + selectionRect.height - wrapperOffset.top + 6 = 100 + 20 - 0 + 6 = 126
      expect(wrapper.style.top).toBe('126px');
    });

    it('should keep an eight-pixel inset from the viewport right edge', () => {
      const wrapper = document.createElement('div');
      const selectionRect: DOMRect = {
        x: 900,
        y: 100,
        width: 50,
        height: 20,
        top: 100,
        right: 950,
        bottom: 120,
        left: 900,
        toJSON: () => ({}),
      };
      const wrapperOffset: DOMRect = {
        x: 0,
        y: 0,
        width: 1000,
        height: 500,
        top: 0,
        right: 1000,
        bottom: 500,
        left: 0,
        toJSON: () => ({}),
      };
      const contentRect: DOMRect = {
        x: 0,
        y: 0,
        width: 1000,
        height: 500,
        top: 0,
        right: 1000,
        bottom: 500,
        left: 0,
        toJSON: () => ({}),
      };
      const popoverWidth = 200;

      positioner.apply({
        wrapper,
        selectionRect,
        wrapperOffset,
        contentRect,
        popoverWidth,
      });

      expect(wrapper.style.left).toBe('792px');
    });

    it('should handle popover width of 0', () => {
      const wrapper = document.createElement('div');
      const selectionRect: DOMRect = {
        x: 100,
        y: 100,
        width: 50,
        height: 20,
        top: 100,
        right: 150,
        bottom: 120,
        left: 100,
        toJSON: () => ({}),
      };
      const wrapperOffset: DOMRect = {
        x: 0,
        y: 0,
        width: 1000,
        height: 500,
        top: 0,
        right: 1000,
        bottom: 500,
        left: 0,
        toJSON: () => ({}),
      };
      const contentRect: DOMRect = {
        x: 0,
        y: 0,
        width: 1000,
        height: 500,
        top: 0,
        right: 1000,
        bottom: 500,
        left: 0,
        toJSON: () => ({}),
      };

      positioner.apply({
        wrapper,
        selectionRect,
        wrapperOffset,
        contentRect,
        popoverWidth: 0,
      });

      // Should still set position even with 0 width
      expect(wrapper.style.left).toBe('100px');
      expect(wrapper.style.top).toBe('126px');
    });
  });

  describe('mobile', () => {
    beforeEach(() => {
      positioner = new InlinePositioner(true);
    });

    it('should use mobile vertical margin (20px)', () => {
      const wrapper = document.createElement('div');
      const selectionRect: DOMRect = {
        x: 100,
        y: 100,
        width: 50,
        height: 20,
        top: 100,
        right: 150,
        bottom: 120,
        left: 100,
        toJSON: () => ({}),
      };
      const wrapperOffset: DOMRect = {
        x: 0,
        y: 0,
        width: 1000,
        height: 500,
        top: 0,
        right: 1000,
        bottom: 500,
        left: 0,
        toJSON: () => ({}),
      };
      const contentRect: DOMRect = {
        x: 0,
        y: 0,
        width: 1000,
        height: 500,
        top: 0,
        right: 1000,
        bottom: 500,
        left: 0,
        toJSON: () => ({}),
      };
      const popoverWidth = 200;

      positioner.apply({
        wrapper,
        selectionRect,
        wrapperOffset,
        contentRect,
        popoverWidth,
      });

      // Y position: selectionRect.y + selectionRect.height - wrapperOffset.top + 20 = 100 + 20 - 0 + 20 = 140
      expect(wrapper.style.top).toBe('140px');
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      positioner = new InlinePositioner(false);
    });

    it('should handle wrapper offset with non-zero x and top values', () => {
      const wrapper = document.createElement('div');
      const selectionRect: DOMRect = {
        x: 100,
        y: 100,
        width: 50,
        height: 20,
        top: 100,
        right: 150,
        bottom: 120,
        left: 100,
        toJSON: () => ({}),
      };
      const wrapperOffset: DOMRect = {
        x: 10,
        y: 5,
        width: 1000,
        height: 500,
        top: 5,
        right: 1010,
        bottom: 505,
        left: 10,
        toJSON: () => ({}),
      };
      const contentRect: DOMRect = {
        x: 0,
        y: 0,
        width: 1000,
        height: 500,
        top: 0,
        right: 1000,
        bottom: 500,
        left: 0,
        toJSON: () => ({}),
      };
      const popoverWidth = 200;

      positioner.apply({
        wrapper,
        selectionRect,
        wrapperOffset,
        contentRect,
        popoverWidth,
      });

      // X position: 100 - 10 = 90
      expect(wrapper.style.left).toBe('90px');
      // Y position: 100 + 20 - 5 + 6 = 121
      expect(wrapper.style.top).toBe('121px');
    });
  });
});
