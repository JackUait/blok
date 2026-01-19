import { beforeEach, describe, expect, it } from 'vitest';
import { InlinePositioner } from '../../../../../../src/components/modules/toolbar/inline/positioner';
import type { InlinePositioningOptions } from '../../../../../../src/components/modules/toolbar/inline/types';

describe('InlinePositioner', () => {
  let positioner: InlinePositioner;
  let mockWrapper: HTMLElement;
  let mockOptions: InlinePositioningOptions;

  beforeEach(() => {
    mockWrapper = document.createElement('div');
    document.body.appendChild(mockWrapper);

    mockOptions = {
      wrapper: mockWrapper,
      selectionRect: new DOMRect(100, 200, 50, 20),
      wrapperOffset: new DOMRect(0, 0, 800, 600),
      contentRect: new DOMRect(0, 0, 800, 600),
      popoverWidth: 200,
    };
  });

  describe('constructor', () => {
    it('uses desktop margin when isMobile is false', () => {
      positioner = new InlinePositioner(false);

      // Should position below selection with desktop margin
      positioner.apply(mockOptions);

      expect(mockWrapper.style.top).toBeDefined();
    });

    it('uses mobile margin when isMobile is true', () => {
      positioner = new InlinePositioner(true);

      positioner.apply(mockOptions);

      expect(mockWrapper.style.top).toBeDefined();
    });
  });

  describe('apply', () => {
    it('sets wrapper position based on selection', () => {
      positioner = new InlinePositioner(false);

      positioner.apply(mockOptions);

      expect(mockWrapper.style.left).toBeDefined();
      expect(mockWrapper.style.top).toBeDefined();
    });

    it('positions toolbar below selection with margin', () => {
      positioner = new InlinePositioner(false);

      positioner.apply(mockOptions);

      // Y should be selection bottom + margin (6px for desktop)
      const expectedY = 200 + 20 + 6; // selectionY + selectionHeight + margin
      expect(mockWrapper.style.top).toBe(`${Math.floor(expectedY)}px`);
    });

    it('aligns toolbar left with selection left', () => {
      positioner = new InlinePositioner(false);

      positioner.apply(mockOptions);

      // X should be selection left minus wrapper offset left
      expect(mockWrapper.style.left).toBe('100px');
    });

    it('prevents overflow on right side', () => {
      positioner = new InlinePositioner(false);

      // Selection is near right edge
      mockOptions.selectionRect = new DOMRect(700, 200, 50, 20);
      mockOptions.popoverWidth = 200;

      positioner.apply(mockOptions);

      // Toolbar should be positioned to not overflow content area
      // contentRect.right = 800, popoverWidth = 200
      // Expected x = 800 - 200 - 0 = 600
      expect(parseInt(mockWrapper.style.left, 10)).toBeLessThanOrEqual(600);
    });

    it('handles mobile positioning with larger margin', () => {
      positioner = new InlinePositioner(true);

      positioner.apply(mockOptions);

      // Mobile margin is 20px
      const expectedY = 200 + 20 + 20; // selectionY + selectionHeight + mobileMargin
      expect(mockWrapper.style.top).toBe(`${Math.floor(expectedY)}px`);
    });

    it('floors coordinate values', () => {
      positioner = new InlinePositioner(false);

      // Use values that would result in decimals
      mockOptions.selectionRect = new DOMRect(100.5, 200.7, 50.3, 20.9);

      positioner.apply(mockOptions);

      // Values should be floored (no decimals)
      expect(mockWrapper.style.left).toMatch(/^\d+px$/);
      expect(mockWrapper.style.top).toMatch(/^\d+px$/);
    });
  });

  describe('edge cases', () => {
    it('handles zero width selection', () => {
      positioner = new InlinePositioner(false);

      mockOptions.selectionRect = new DOMRect(100, 200, 0, 20);

      expect(() => positioner.apply(mockOptions)).not.toThrow();
    });

    it('handles wrapper offset with non-zero values', () => {
      positioner = new InlinePositioner(false);

      mockOptions.wrapperOffset = new DOMRect(10, 20, 800, 600);

      positioner.apply(mockOptions);

      expect(mockWrapper.style.left).toBe('90px'); // 100 - 10
      expect(mockWrapper.style.top).toBeDefined();
    });

    it('handles popover that fits exactly in content area', () => {
      positioner = new InlinePositioner(false);

      mockOptions.selectionRect = new DOMRect(300, 200, 50, 20);
      mockOptions.contentRect = new DOMRect(0, 0, 800, 600);
      mockOptions.popoverWidth = 200;

      positioner.apply(mockOptions);

      // Should align with selection since it fits
      expect(mockWrapper.style.left).toBe('300px');
    });
  });
});
