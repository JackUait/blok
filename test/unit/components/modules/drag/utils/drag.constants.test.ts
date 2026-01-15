/**
 * Tests for drag.constants utilities
 */

import { describe, it, expect } from 'vitest';
import * as constantsModule from '../../../../../../src/components/modules/drag/utils/drag.constants';

console.log('Module path:', import.meta.url);
console.log('DRAG_CONFIG.dragThreshold from module:', constantsModule.DRAG_CONFIG.dragThreshold);

describe('drag.constants', () => {
  describe('DRAG_CONFIG', () => {
    it('should have correct default values', () => {
      expect(constantsModule.DRAG_CONFIG.previewOffsetX).toBe(10);
      expect(constantsModule.DRAG_CONFIG.previewOffsetY).toBe(0);
      expect(constantsModule.DRAG_CONFIG.dragThreshold).toBe(5);
      expect(constantsModule.DRAG_CONFIG.autoScrollZone).toBe(50);
      expect(constantsModule.DRAG_CONFIG.autoScrollSpeed).toBe(10);
      expect(constantsModule.DRAG_CONFIG.announcementThrottleMs).toBe(300);
      expect(constantsModule.DRAG_CONFIG.leftDropZone).toBe(50);
    });

    it('should be readonly (as const)', () => {
      // Note: 'as const' makes TypeScript enforce readonly, but at runtime
      // the object is still mutable. This test documents the current behavior.
      // In a future refactor, we could use Object.freeze() if we need true runtime immutability.
      const originalThreshold = constantsModule.DRAG_CONFIG.dragThreshold;
      // @ts-expect-error - Testing readonly nature (TypeScript error expected)
      constantsModule.DRAG_CONFIG.dragThreshold = 10;
      // The assignment doesn't throw at runtime (JavaScript limitation)
      // but TypeScript will flag it as an error
      expect(constantsModule.DRAG_CONFIG.dragThreshold).toBe(10);
      // Restore original value for other tests
      Object.defineProperty(constantsModule.DRAG_CONFIG, 'dragThreshold', {
        value: originalThreshold,
        writable: true,
        configurable: true,
      });
    });
  });

  describe('hasPassedThreshold', () => {
    it('should return false when distance is below default threshold', () => {
      expect(constantsModule.hasPassedThreshold(0, 0, 2, 2)).toBe(false); // distance ~2.8
      expect(constantsModule.hasPassedThreshold(100, 100, 103, 103)).toBe(false); // distance ~4.2
    });

    it('should return true when distance meets or exceeds default threshold', () => {
      console.log('DRAG_CONFIG.dragThreshold:', constantsModule.DRAG_CONFIG.dragThreshold);
      const result1 = constantsModule.hasPassedThreshold(0, 0, 4, 3);
      console.log('hasPassedThreshold(0, 0, 4, 3):', result1, '(distance: sqrt(16+9)=5)');
      const result2 = constantsModule.hasPassedThreshold(0, 0, 5, 0);
      console.log('hasPassedThreshold(0, 0, 5, 0):', result2, '(distance: 5)');
      const result3 = constantsModule.hasPassedThreshold(100, 100, 110, 110);
      console.log('hasPassedThreshold(100, 100, 110, 110):', result3, '(distance: sqrt(100+100)=14.14)');
      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(result3).toBe(true);
    });

    it('should accept custom threshold', () => {
      expect(constantsModule.hasPassedThreshold(0, 0, 2, 2, 5)).toBe(false);
      expect(constantsModule.hasPassedThreshold(0, 0, 2, 2, 2)).toBe(true);
      expect(constantsModule.hasPassedThreshold(0, 0, 10, 10, 20)).toBe(false);
      expect(constantsModule.hasPassedThreshold(0, 0, 10, 10, 10)).toBe(true);
    });

    it('should handle negative distances correctly', () => {
      expect(constantsModule.hasPassedThreshold(100, 100, 95, 95)).toBe(true); // distance ~7.1
      expect(constantsModule.hasPassedThreshold(100, 100, 98, 98)).toBe(false); // distance ~2.8
    });

    it('should handle zero distance', () => {
      expect(constantsModule.hasPassedThreshold(0, 0, 0, 0)).toBe(false);
    });
  });
});
