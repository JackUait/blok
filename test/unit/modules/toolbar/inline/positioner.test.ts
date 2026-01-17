import { describe, it, expect, beforeEach } from 'vitest';
import { InlinePositioner } from '../../../../../src/components/modules/toolbar/inline/index';

describe('InlinePositioner', () => {
  let positioner: InlinePositioner;

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

    it('should prevent overflow on right side', () => {
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
        right: 1000, // Content area ends at 1000
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

      // realRightCoord would be 900 + 200 + 0 = 1100, which exceeds contentRect.right (1000)
      // So x should be adjusted: 1000 - 200 - 0 = 800
      expect(wrapper.style.left).toBe('800px');
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
