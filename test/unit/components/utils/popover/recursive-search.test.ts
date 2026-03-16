import { describe, it, expect } from 'vitest';
import { DATA_ATTR } from '../../../../../src/components/constants/data-attributes';

describe('Recursive Popover Search', () => {
  describe('data attributes', () => {
    it('should have promotedGroupLabel attribute defined', () => {
      expect(DATA_ATTR.promotedGroupLabel).toBe('data-blok-promoted-group-label');
    });
  });
});
