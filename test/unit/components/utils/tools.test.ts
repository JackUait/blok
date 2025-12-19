import { describe, expect, it } from 'vitest';

import { isToolConvertable } from '../../../../src/components/utils/tools';
import type { BlockToolAdapter } from '../../../../src/components/tools/block';

/**
 * Unit tests for tools.ts utility functions
 */
describe('tools utilities', () => {
  describe('isToolConvertable', () => {
    it('returns false when tool has no conversion config', () => {
      const tool = {
        conversionConfig: undefined,
      } as unknown as BlockToolAdapter;

      expect(isToolConvertable(tool, 'export')).toBe(false);
      expect(isToolConvertable(tool, 'import')).toBe(false);
    });

    it('returns true when conversion config direction is a string', () => {
      const tool = {
        conversionConfig: {
          export: 'text',
        },
      } as unknown as BlockToolAdapter;

      expect(isToolConvertable(tool, 'export')).toBe(true);
    });

    it('returns true when conversion config direction is a function', () => {
      const tool = {
        conversionConfig: {
          import: (_value: string) => ({ text: _value }),
        },
      } as unknown as BlockToolAdapter;

      expect(isToolConvertable(tool, 'import')).toBe(true);
    });

    it('returns false when conversion config is missing the requested direction', () => {
      const tool = {
        conversionConfig: {
          export: 'text',
        },
      } as unknown as BlockToolAdapter;

      expect(isToolConvertable(tool, 'import')).toBe(false);
    });

    it('returns false when conversion prop is not a string or function', () => {
      const tool = {
        conversionConfig: {
          import: 42,
        },
      } as unknown as BlockToolAdapter;

      expect(isToolConvertable(tool, 'import')).toBe(false);
    });
  });
});
