import { describe, it, expect } from 'vitest';
import { normalizeListItemData } from '../../../../src/tools/list/data-normalizer';
import type { ListItemData, ListItemConfig } from '../../../../src/tools/list/types';

describe('data-normalizer', () => {
  describe('normalizeListItemData', () => {
    const defaultSettings: ListItemConfig = {};

    it('returns empty list item data for empty object', () => {
      const result = normalizeListItemData({}, defaultSettings);

      expect(result).toEqual({
        text: '',
        style: 'unordered',
        checked: false,
        depth: 0,
      });
    });

    it('uses defaultStyle from settings when style is not provided', () => {
      const settings: ListItemConfig = { defaultStyle: 'ordered' };
      const result = normalizeListItemData({}, settings);

      expect(result.style).toBe('ordered');
    });

    it('uses unordered as default style when no settings provided', () => {
      const result = normalizeListItemData({}, defaultSettings);

      expect(result.style).toBe('unordered');
    });

    it('preserves provided text', () => {
      const data = { text: 'Hello world' };
      const result = normalizeListItemData(data, defaultSettings);

      expect(result.text).toBe('Hello world');
    });

    it('defaults to empty string when text is not provided', () => {
      const data = { style: 'unordered' as const };
      const result = normalizeListItemData(data, defaultSettings);

      expect(result.text).toBe('');
    });

    it('preserves provided style', () => {
      const data = { style: 'checklist' as const };
      const result = normalizeListItemData(data, defaultSettings);

      expect(result.style).toBe('checklist');
    });

    it('preserves provided checked state', () => {
      const data = { checked: true };
      const result = normalizeListItemData(data, defaultSettings);

      expect(result.checked).toBe(true);
    });

    it('defaults checked to false when not provided', () => {
      const data = { text: 'Item' };
      const result = normalizeListItemData(data, defaultSettings);

      expect(result.checked).toBe(false);
    });

    it('converts checked to boolean', () => {
      const data1 = { checked: 1 };
      const result1 = normalizeListItemData(data1, defaultSettings);
      expect(result1.checked).toBe(true);

      const data2 = { checked: 0 };
      const result2 = normalizeListItemData(data2, defaultSettings);
      expect(result2.checked).toBe(false);
    });

    it('preserves provided depth', () => {
      const data = { depth: 2 };
      const result = normalizeListItemData(data, defaultSettings);

      expect(result.depth).toBe(2);
    });

    it('defaults depth to 0 when not provided', () => {
      const data = { text: 'Item' };
      const result = normalizeListItemData(data, defaultSettings);

      expect(result.depth).toBe(0);
    });

    it('uses nullish coalescing for depth (undefined becomes 0)', () => {
      const data = { depth: undefined };
      const result = normalizeListItemData(data, defaultSettings);

      expect(result.depth).toBe(0);
    });

    it('includes start value when not equal to 1', () => {
      const data = { start: 5 };
      const result = normalizeListItemData(data, defaultSettings);

      expect(result.start).toBe(5);
    });

    it('omits start value when equal to 1', () => {
      const data = { start: 1 };
      const result = normalizeListItemData(data, defaultSettings);

      expect(result.start).toBeUndefined();
    });

    it('omits start value when not provided', () => {
      const data = { text: 'Item' };
      const result = normalizeListItemData(data, defaultSettings);

      expect(result.start).toBeUndefined();
    });

    describe('legacy format compatibility', () => {
      it('extracts text from first item in legacy items array', () => {
        const legacyData = {
          items: [{ content: 'First item' }, { content: 'Second item' }],
        };

        const result = normalizeListItemData(legacyData, defaultSettings);

        expect(result.text).toBe('First item');
      });

      it('extracts checked state from first item in legacy items array', () => {
        const legacyData = {
          items: [{ content: 'Task', checked: true }],
          style: 'checklist' as const,
        };

        const result = normalizeListItemData(legacyData, defaultSettings);

        expect(result.checked).toBe(true);
      });

      it('defaults checked to false when not in legacy item', () => {
        const legacyData = {
          items: [{ content: 'Task' }],
          style: 'checklist' as const,
        };

        const result = normalizeListItemData(legacyData, defaultSettings);

        expect(result.checked).toBe(false);
      });

      it('preserves style from legacy format', () => {
        const legacyData = {
          items: [{ content: 'Item' }],
          style: 'ordered' as const,
        };

        const result = normalizeListItemData(legacyData, defaultSettings);

        expect(result.style).toBe('ordered');
      });

      it('uses default style when legacy format has no style', () => {
        const legacyData = {
          items: [{ content: 'Item' }],
        };

        const result = normalizeListItemData(legacyData, defaultSettings);

        expect(result.style).toBe('unordered');
      });

      it('includes start value from legacy format', () => {
        const legacyData = {
          items: [{ content: 'Item' }],
          start: 10,
        };

        const result = normalizeListItemData(legacyData, defaultSettings);

        expect(result.start).toBe(10);
      });

      it('omits start value when equal to 1 in legacy format', () => {
        const legacyData = {
          items: [{ content: 'Item' }],
          start: 1,
        };

        const result = normalizeListItemData(legacyData, defaultSettings);

        expect(result.start).toBeUndefined();
      });

      it('handles empty legacy items array', () => {
        const legacyData = {
          items: [],
        };

        const result = normalizeListItemData(legacyData, defaultSettings);

        expect(result.text).toBe('');
      });

      it('handles legacy item with no content property', () => {
        const legacyData = {
          items: [{}],
        };

        const result = normalizeListItemData(legacyData, defaultSettings);

        expect(result.text).toBe('');
      });

      it('sets depth to 0 for legacy format', () => {
        const legacyData = {
          items: [{ content: 'Item' }],
        };

        const result = normalizeListItemData(legacyData, defaultSettings);

        expect(result.depth).toBe(0);
      });

      it('converts checked to boolean in legacy format', () => {
        const legacyData = {
          items: [{ content: 'Task', checked: 'true' }],
        };

        const result = normalizeListItemData(legacyData, defaultSettings);

        expect(result.checked).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('handles null input', () => {
        const result = normalizeListItemData(null, defaultSettings);

        expect(result).toEqual({
          text: '',
          style: 'unordered',
          checked: false,
          depth: 0,
        });
      });

      it('handles undefined input', () => {
        const result = normalizeListItemData(undefined, defaultSettings);

        expect(result).toEqual({
          text: '',
          style: 'unordered',
          checked: false,
          depth: 0,
        });
      });

      it('handles non-object input', () => {
        const result = normalizeListItemData('string', defaultSettings);

        expect(result).toEqual({
          text: '',
          style: 'unordered',
          checked: false,
          depth: 0,
        });
      });

      it('handles all properties provided', () => {
        const data: ListItemData = {
          text: 'Full item',
          style: 'ordered',
          checked: false,
          depth: 2,
          start: 5,
        };

        const result = normalizeListItemData(data, defaultSettings);

        expect(result).toEqual({
          text: 'Full item',
          style: 'ordered',
          checked: false,
          depth: 2,
          start: 5,
        });
      });

      it('handles zero as start value', () => {
        const data = { start: 0 };
        const result = normalizeListItemData(data, defaultSettings);

        expect(result.start).toBe(0);
      });

      it('handles negative depth', () => {
        const data = { depth: -1 };
        const result = normalizeListItemData(data, defaultSettings);

        expect(result.depth).toBe(-1);
      });
    });
  });
});
